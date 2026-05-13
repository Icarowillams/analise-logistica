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

    // Atualiza todos os pendentes
    let atualizados = 0;
    for (const log of logsPendentes) {
      await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, {
        status: novoStatus,
        numero_nf: numeroNf || log.numero_nf || '',
        mensagem,
        codigo_sefaz: novoStatus === 'autorizada' ? '100' : ''
      });
      atualizados++;
    }

    return Response.json({
      sucesso: true,
      codigo_pedido: codigoPedido,
      novo_status: novoStatus,
      logs_atualizados: atualizados,
      numero_nf: numeroNf
    });
  } catch (error) {
    console.error('[reconciliarLogEmissaoNF] erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});