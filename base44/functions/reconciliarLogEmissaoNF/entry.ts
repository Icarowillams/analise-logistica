import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// 🔄 Atualiza LogEmissaoNF "pendente" quando o webhook atualiza o espelho PedidoLiberadoOmie.
// Disparado por entity automation em PedidoLiberadoOmie (create/update).
//
// Cenário: emitirNfsLoteOmie cria logs com status='pendente' quando o polling estoura
// o timeout. Quando o webhook NFe.NotaAutorizada/Rejeitada chega depois, o espelho
// é atualizado com status_real e numero_nf — esta função "casa" os dois e marca o
// log como autorizada/rejeitada.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));

    const eventType = payload?.event?.type;
    const entityName = payload?.event?.entity_name;
    const entityId = payload?.event?.entity_id;
    let data = payload?.data;

    if (entityName !== 'PedidoLiberadoOmie' || !['create', 'update'].includes(eventType)) {
      return Response.json({ ignorado: true, motivo: 'evento não aplicável' });
    }

    if (payload?.payload_too_large || !data) {
      data = await base44.asServiceRole.entities.PedidoLiberadoOmie.get(entityId);
    }

    const codigoPedido = String(data?.codigo_pedido || '');
    const statusReal = String(data?.status_real || '');
    const numeroNf = data?.numero_nf || '';
    const etapa = String(data?.etapa || '');

    if (!codigoPedido) {
      return Response.json({ ignorado: true, motivo: 'sem codigo_pedido' });
    }

    // Determina o status final do log com base no espelho
    let novoStatus = null;
    let mensagem = data?.status_label || '';

    if (statusReal === 'emitida' || (etapa === '60' && numeroNf)) {
      novoStatus = 'autorizada';
      mensagem = `NF ${numeroNf} autorizada`;
    } else if (statusReal === 'rejeitada') {
      novoStatus = 'rejeitada';
      mensagem = mensagem || 'NF rejeitada';
    } else if (statusReal === 'cancelada' || statusReal === 'denegada') {
      novoStatus = 'rejeitada';
      mensagem = mensagem || `NF ${statusReal}`;
    }

    if (!novoStatus) {
      return Response.json({ ignorado: true, motivo: 'espelho ainda sem status final', status_real: statusReal });
    }

    // Busca logs PENDENTES desse pedido (pode haver várias tentativas)
    const logsPendentes = await base44.asServiceRole.entities.LogEmissaoNF.filter({
      codigo_pedido: codigoPedido,
      status: 'pendente'
    });

    if (logsPendentes.length === 0) {
      return Response.json({ ignorado: true, motivo: 'sem logs pendentes para este pedido' });
    }

    // Atualiza todos os pendentes — só dispara boleto UMA vez por reconciliação
    let atualizados = 0;
    let boletoDisparado = false;

    // Se NF foi autorizada, verifica se precisa gerar boleto automático
    // (cliente com modalidade BOLETO BANCARIO + pedido tipo "venda")
    let deveGerarBoleto = false;
    if (novoStatus === 'autorizada') {
      try {
        const pedidos = await base44.asServiceRole.entities.Pedido.filter({
          omie_codigo_pedido: codigoPedido
        });
        const pedido = pedidos?.[0];
        if (pedido?.cliente_id) {
          const tipo = String(pedido.tipo || 'venda').toLowerCase();
          if (tipo === 'venda') {
            const cliente = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id);
            if (cliente?.modalidade_pagamento_id) {
              const modalidade = await base44.asServiceRole.entities.ModalidadePagamento.get(cliente.modalidade_pagamento_id);
              const nome = String(modalidade?.nome || '').toUpperCase();
              deveGerarBoleto = nome.includes('BOLETO');
              console.log(`[reconciliarLogEmissaoNF] pedido ${codigoPedido}: modalidade="${nome}" tipo=${tipo} → boleto=${deveGerarBoleto}`);
            } else {
              console.log(`[reconciliarLogEmissaoNF] pedido ${codigoPedido}: cliente sem modalidade_pagamento_id`);
            }
          } else {
            console.log(`[reconciliarLogEmissaoNF] pedido ${codigoPedido}: tipo=${tipo} (não-venda) — sem boleto`);
          }
        }
      } catch (e) {
        console.error(`[reconciliarLogEmissaoNF] erro ao verificar boleto:`, e.message);
      }
    }

    for (const log of logsPendentes) {
      // Só marca boleto_gerado=true no primeiro log atualizado para evitar duplicar disparo
      const marcarBoletoNoLog = deveGerarBoleto && !boletoDisparado;
      await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, {
        status: novoStatus,
        numero_nf: numeroNf || log.numero_nf || '',
        mensagem,
        codigo_sefaz: novoStatus === 'autorizada' ? '100' : '',
        boleto_gerado: marcarBoletoNoLog ? true : (log.boleto_gerado || false)
      });
      if (marcarBoletoNoLog) boletoDisparado = true;
      atualizados++;
    }

    // 🤖 Dispara geração de boleto APÓS atualizar logs — espera ~5s pro Omie criar o título
    let boletoResultado = null;
    if (deveGerarBoleto) {
      try {
        // Aguarda Omie criar o título de contas a receber após autorização da NF
        await new Promise(r => setTimeout(r, 5000));
        const inv = await base44.asServiceRole.functions.invoke('gerarBoletosAutoPedidos', {
          codigos_pedido: [codigoPedido]
        });
        boletoResultado = inv?.data || null;
        console.log(`[reconciliarLogEmissaoNF] boleto auto pedido ${codigoPedido}:`, JSON.stringify(boletoResultado).slice(0, 300));
      } catch (e) {
        console.error(`[reconciliarLogEmissaoNF] erro ao gerar boleto auto:`, e.message);
        boletoResultado = { error: e.message };
      }
    }

    return Response.json({
      sucesso: true,
      codigo_pedido: codigoPedido,
      novo_status: novoStatus,
      logs_atualizados: atualizados,
      numero_nf: numeroNf,
      boleto_disparado: deveGerarBoleto,
      boleto_resultado: boletoResultado
    });
  } catch (error) {
    console.error('[reconciliarLogEmissaoNF] erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});