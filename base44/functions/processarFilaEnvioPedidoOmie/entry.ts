import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MAX_TENTATIVAS = 3;
const INTERVALO_ENTRE_PEDIDOS_MS = 5000;
const MAX_PEDIDOS_POR_RODADA = 10;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // 1) Verificar circuit breaker ANTES de tudo
    const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
      .filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
    const controle = cb?.[0];
    if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
      console.log(`[processarFilaEnvioPedidoOmie] Circuit breaker ATIVO até ${controle.bloqueado_ate}. Abortando.`);
      return Response.json({
        sucesso: true,
        mensagem: 'Circuit breaker ativo — abortando rodada',
        bloqueado_ate: controle.bloqueado_ate,
        processados: 0
      });
    }

    // 2) Buscar registros pendentes na fila
    const pendentes = await base44.asServiceRole.entities.FilaEnvioPedidoOmie
      .filter({ status: 'pendente' }, 'created_date', MAX_PEDIDOS_POR_RODADA);

    if (pendentes.length === 0) {
      return Response.json({ sucesso: true, mensagem: 'Nenhum pedido na fila', processados: 0 });
    }

    console.log(`[processarFilaEnvioPedidoOmie] Processando ${pendentes.length} pedidos da fila`);

    const resultados = [];

    for (let i = 0; i < pendentes.length; i++) {
      const item = pendentes[i];

      // Re-verificar circuit breaker a cada pedido
      const cbCheck = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
        .filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
      if (cbCheck?.[0]?.bloqueado && cbCheck[0].bloqueado_ate && new Date(cbCheck[0].bloqueado_ate) > new Date()) {
        console.log(`[processarFilaEnvioPedidoOmie] Circuit breaker ativou durante processamento. Abortando restante.`);
        break;
      }

      // Marcar como processando
      await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
        status: 'processando',
        tentativas: (item.tentativas || 0) + 1
      });

      try {
        // Verificar idempotência: pedido já enviado?
        let pedido;
        try {
          pedido = await base44.asServiceRole.entities.Pedido.get(item.pedido_id);
        } catch {
          await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
            status: 'erro',
            erro_log: 'Pedido não encontrado no Base44',
            processado_em: new Date().toISOString()
          });
          resultados.push({ pedido_id: item.pedido_id, sucesso: false, erro: 'Pedido não encontrado' });
          continue;
        }

        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
          // Já enviado — marcar como concluído
          await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
            status: 'concluido',
            codigo_pedido_omie: pedido.omie_codigo_pedido,
            numero_pedido_omie: pedido.numero_pedido,
            processado_em: new Date().toISOString(),
            erro_log: null
          });
          resultados.push({ pedido_id: item.pedido_id, sucesso: true, mensagem: 'Já estava enviado' });
          continue;
        }

        // Chamar enviarPedidoOmie via SDK (reutiliza toda a lógica existente)
        const response = await base44.asServiceRole.functions.invoke('enviarPedidoOmie', {
          pedido_id: item.pedido_id
        });
        const result = response?.data || response;

        if (result?.sucesso) {
          await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
            status: 'concluido',
            codigo_pedido_omie: result.codigo_pedido_omie || null,
            numero_pedido_omie: result.numero_pedido_omie || null,
            processado_em: new Date().toISOString(),
            erro_log: null
          });
          resultados.push({ pedido_id: item.pedido_id, sucesso: true, codigo: result.codigo_pedido_omie });
        } else {
          const erro = result?.erro || 'Erro desconhecido';
          const tentativas = (item.tentativas || 0) + 1;
          const novoStatus = tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente';
          await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
            status: novoStatus,
            erro_log: erro,
            processado_em: novoStatus === 'erro' ? new Date().toISOString() : null
          });
          resultados.push({ pedido_id: item.pedido_id, sucesso: false, erro, tentativas });
        }
      } catch (err) {
        const erro = err?.message || 'Erro interno';
        const tentativas = (item.tentativas || 0) + 1;
        const novoStatus = tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente';
        
        // Se for bloqueio 425, abortar o restante
        const isBloqueio = /425|bloqueada|bloqueio|consumo indevido/i.test(erro);
        
        await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
          status: isBloqueio ? 'pendente' : novoStatus,
          erro_log: erro,
          tentativas: isBloqueio ? (item.tentativas || 0) : tentativas,
          processado_em: (!isBloqueio && novoStatus === 'erro') ? new Date().toISOString() : null
        });
        resultados.push({ pedido_id: item.pedido_id, sucesso: false, erro });

        if (isBloqueio) {
          console.log(`[processarFilaEnvioPedidoOmie] Bloqueio 425 detectado. Abortando restante.`);
          break;
        }
      }

      // Aguardar intervalo entre pedidos (exceto último)
      if (i < pendentes.length - 1) {
        console.log(`[processarFilaEnvioPedidoOmie] Aguardando ${INTERVALO_ENTRE_PEDIDOS_MS / 1000}s antes do próximo...`);
        await sleep(INTERVALO_ENTRE_PEDIDOS_MS);
      }
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso).length;

    console.log(`[processarFilaEnvioPedidoOmie] Rodada concluída: ${sucessos} sucessos, ${erros} erros de ${resultados.length} processados`);

    return Response.json({
      sucesso: true,
      processados: resultados.length,
      sucessos,
      erros,
      resultados
    });
  } catch (error) {
    console.error('[processarFilaEnvioPedidoOmie] Erro fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});