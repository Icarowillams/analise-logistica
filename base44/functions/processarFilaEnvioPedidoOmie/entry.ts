import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MAX_TENTATIVAS = 3;
const INTERVALO_ENTRE_PEDIDOS_MS = 3000; // 3s entre pedidos (era 5s)
const MAX_PEDIDOS_POR_RODADA = 3; // 3 pedidos por rodada (era 5) — menor lote, mais frequente

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

    // ============================================================
    // PRÉ-CARREGAMENTO EM LOTE — evita N chamadas individuais no loop
    // ============================================================
    const pedidoIds = pendentes.map(p => p.pedido_id).filter(Boolean);
    const t0Preload = Date.now();

    // Buscar todos os pedidos de uma vez
    const todosPedidos = await Promise.all(
      pedidoIds.map(id => base44.asServiceRole.entities.Pedido.get(id).catch(() => null))
    );
    const pedidosPorId = {};
    todosPedidos.forEach(p => { if (p) pedidosPorId[p.id] = p; });

    // Buscar todos os itens de pedido
    const todosItems = await Promise.all(
      pedidoIds.map(id => base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: id }).catch(() => []))
    );
    const itemsPorPedido = {};
    pedidoIds.forEach((id, idx) => { itemsPorPedido[id] = todosItems[idx] || []; });

    // Coletar IDs únicos de clientes, produtos e planos
    const clienteIds = [...new Set(Object.values(pedidosPorId).map(p => p.cliente_id).filter(Boolean))];
    const produtoIds = [...new Set(Object.values(itemsPorPedido).flatMap(items => items.map(i => i.produto_id)).filter(Boolean))];
    const planoIds = [...new Set(Object.values(pedidosPorId).map(p => p.plano_pagamento_id).filter(Boolean))];

    // Buscar todos em paralelo
    const [todosClientes, todosProdutos, todosPlanos, todasUnidades] = await Promise.all([
      Promise.all(clienteIds.map(id => base44.asServiceRole.entities.Cliente.get(id).catch(() => null))),
      Promise.all(produtoIds.map(id => base44.asServiceRole.entities.Produto.get(id).catch(() => null))),
      Promise.all(planoIds.map(id => base44.asServiceRole.entities.PlanoPagamento.get(id).catch(() => null))),
      base44.asServiceRole.entities.UnidadeMedida.list().catch(() => [])
    ]);

    const clientesPorId = {};
    todosClientes.forEach(c => { if (c) clientesPorId[c.id] = c; });
    const produtosMap = {};
    todosProdutos.forEach(p => { if (p) produtosMap[p.id] = p; });
    const planosPorId = {};
    todosPlanos.forEach(p => { if (p) planosPorId[p.id] = p; });
    const unidadesMap = {};
    todasUnidades.forEach(u => { if (u) unidadesMap[u.id] = u; });

    console.log(`[processarFilaEnvioPedidoOmie] Pré-carregamento concluído em ${Date.now() - t0Preload}ms — ${clienteIds.length} clientes, ${produtoIds.length} produtos, ${planoIds.length} planos, ${todasUnidades.length} unidades`);

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

        // Chamar enviarPedidoOmie com ctx pré-carregado (evita cold start + buscas individuais)
        const response = await base44.asServiceRole.functions.invoke('enviarPedidoOmie', {
          pedido_id: item.pedido_id,
          ctx: { itemsPorPedido, clientesPorId, produtosMap, planosPorId, unidadesMap }
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

          // Verificação de segurança: mesmo com erro, se o pedido já tem código Omie,
          // tratar como sucesso (evita omie_enviado=false para pedidos que já existem)
          let pedidoVerif;
          try { pedidoVerif = await base44.asServiceRole.entities.Pedido.get(item.pedido_id); } catch { /* ignore */ }
          if (pedidoVerif?.omie_codigo_pedido) {
            console.log(`[processarFilaEnvioPedidoOmie] Pedido ${item.pedido_id} retornou erro mas já tem código Omie ${pedidoVerif.omie_codigo_pedido} — tratando como sucesso`);
            if (!pedidoVerif.omie_enviado) {
              await base44.asServiceRole.entities.Pedido.update(item.pedido_id, { omie_enviado: true, omie_erro: null });
            }
            await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
              status: 'concluido',
              codigo_pedido_omie: pedidoVerif.omie_codigo_pedido,
              numero_pedido_omie: pedidoVerif.numero_pedido,
              processado_em: new Date().toISOString(),
              erro_log: null
            });
            resultados.push({ pedido_id: item.pedido_id, sucesso: true, codigo: pedidoVerif.omie_codigo_pedido, mensagem: 'Recuperado via verificação local' });
            continue;
          }

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
        
        // Se for bloqueio 403/425/429 OU suspensão → abortar o restante e abrir circuit breaker
        const isBloqueio = /403|425|429|bloqueada|bloqueio|consumo indevido|suspens|inválida|invalida|suspended|rate.?limit/i.test(erro);
        
        await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
          status: isBloqueio ? 'pendente' : novoStatus,
          erro_log: erro,
          tentativas: isBloqueio ? (item.tentativas || 0) : tentativas,
          processado_em: (!isBloqueio && novoStatus === 'erro') ? new Date().toISOString() : null
        });
        resultados.push({ pedido_id: item.pedido_id, sucesso: false, erro });

        if (isBloqueio) {
          console.log(`[processarFilaEnvioPedidoOmie] Bloqueio detectado: ${erro}. Abrindo circuit breaker e abortando restante.`);
          // Abrir circuit breaker por 2 horas
          const cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
            .filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
          const cbPayload = {
            chave: 'principal',
            bloqueado: true,
            bloqueado_ate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            ultimo_erro: erro,
            atualizado_em: new Date().toISOString()
          };
          if (cbRows?.[0]?.id) {
            await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(cbRows[0].id, cbPayload).catch(() => {});
          } else {
            await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(cbPayload).catch(() => {});
          }
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