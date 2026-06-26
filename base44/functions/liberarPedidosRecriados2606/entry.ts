import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';
const PAUSA_ENTRE_MS = 2500;

// One-shot (NÃO botão permanente): libera 10→20 os pedidos recriados em 26/06.
// Reusa a função EXISTENTE liberarPedidoOmie (que já confirma etapa real e atualiza o espelho).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Apenas administradores podem executar esta rotina.' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const idsRecebidos = Array.isArray(body.pedido_ids) ? body.pedido_ids : [];
    // Lote por execução — o Deno tem timeout ~180s e cada liberação leva ~4s (TrocarEtapa+ConsultarPedido+pausa).
    // Processa no máximo max_processar por chamada; o restante volta como pendente para a próxima invocação.
    const maxProcessar = Number(body.max_processar) > 0 ? Number(body.max_processar) : 25;
    if (idsRecebidos.length === 0) {
      return Response.json({ error: 'Informe pedido_ids (array de IDs).' }, { status: 400 });
    }

    // Filtra os candidatos: só os que TÊM omie_codigo_pedido preenchido E status liberado.
    const candidatos = [];
    const naoElegiveis = [];
    for (const id of idsRecebidos) {
      const p = await base44.asServiceRole.entities.Pedido.get(id).catch(() => null);
      if (!p) { naoElegiveis.push(id); continue; }
      if (p.omie_codigo_pedido && String(p.omie_codigo_pedido).trim() !== '' && p.status === 'liberado') {
        candidatos.push(p);
      } else {
        naoElegiveis.push(id);
      }
    }

    // Aplica o limite de lote: pega só os primeiros maxProcessar; o resto fica pendente.
    const restantesLote = candidatos.slice(maxProcessar).map((c) => ({ id: c.id, numero_pedido: c.numero_pedido || '', codigo_omie: c.omie_codigo_pedido }));
    const aProcessar = candidatos.slice(0, maxProcessar);

    const resumo = { total_candidatos: candidatos.length, liberados: [], ja_etapa_20: [], falhas: [], pendentes: [...restantesLote], parado_por_breaker: false };

    for (let i = 0; i < aProcessar.length; i++) {
      const pedido = aProcessar[i];
      const ref = { id: pedido.id, numero_pedido: pedido.numero_pedido || '', codigo_omie: pedido.omie_codigo_pedido };

      // Breaker: para imediatamente e devolve o que falta como pendente.
      const cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
      const cb = cbRows?.[0];
      const bloqueado = cb?.bloqueado && cb?.bloqueado_ate && new Date(cb.bloqueado_ate).getTime() > Date.now();
      if (bloqueado) {
        resumo.parado_por_breaker = true;
        resumo.pendentes = [...aProcessar.slice(i).map((c) => ({ id: c.id, numero_pedido: c.numero_pedido || '', codigo_omie: c.omie_codigo_pedido })), ...restantesLote];
        resumo.breaker_bloqueado_ate = cb.bloqueado_ate;
        break;
      }

      // Chama DIRETO a liberarPedidoOmie — ela já é idempotente (não move se já estiver liberado)
      // e já confirma a etapa real internamente. NÃO consultar etapa antes: bater 2x no mesmo
      // pedido em sequência dispara "consumo indevido" no Omie e aciona o circuit breaker.
      let resp;
      try {
        const r = await base44.functions.invoke('liberarPedidoOmie', { pedido_id: pedido.id, etapa: '20' });
        resp = r?.data || {};
      } catch (e) {
        resp = { sucesso: false, erro: e?.message || String(e) };
      }

      if (resp.sucesso) {
        resumo.liberados.push(ref);
      } else if (/já.*liberado|etapa 20|already/i.test(resp.erro || resp.mensagem || '')) {
        resumo.ja_etapa_20.push(ref);
      } else if (resp.etapa_revertida) {
        // O Omie reverteu para a etapa 10 (trava de estoque na etapa "Separar Estoque").
        // Não é erro de rate limit — registra como falha de estoque e SEGUE para o próximo.
        resumo.falhas.push({ ...ref, motivo: 'Estoque/trava: Omie reverteu para etapa 10', estoque: true });
      } else {
        resumo.falhas.push({ ...ref, motivo: resp.erro || resp.error || resp.mensagem || 'Falha desconhecida' });
        // Bloqueio/consumo indevido: para e devolve o restante como pendente.
        if (resp.redundante || resp.omie_bloqueada || /bloquead|redundante|cota|consumo indevido|misuse/i.test(resp.erro || resp.error || '')) {
          resumo.parado_por_breaker = true;
          resumo.pendentes = [...aProcessar.slice(i + 1).map((c) => ({ id: c.id, numero_pedido: c.numero_pedido || '', codigo_omie: c.omie_codigo_pedido })), ...restantesLote];
          break;
        }
      }

      if (i < aProcessar.length - 1) await sleep(PAUSA_ENTRE_MS);
    }

    const idsPendentes = resumo.pendentes.map((p) => p.id);
    return Response.json({
      sucesso: true,
      total_candidatos: resumo.total_candidatos,
      total_nao_elegiveis: naoElegiveis.length,
      total_liberados: resumo.liberados.length,
      total_ja_etapa_20: resumo.ja_etapa_20.length,
      total_falhas: resumo.falhas.length,
      total_pendentes: resumo.pendentes.length,
      ha_mais_lotes: idsPendentes.length > 0,
      reinvocar_com: idsPendentes.length > 0 ? { pedido_ids: idsPendentes } : null,
      parado_por_breaker: resumo.parado_por_breaker,
      ...(resumo.breaker_bloqueado_ate ? { breaker_bloqueado_ate: resumo.breaker_bloqueado_ate } : {}),
      detalhe: resumo
    });
  } catch (error) {
    return Response.json({ sucesso: false, error: error.message }, { status: 500 });
  }
});