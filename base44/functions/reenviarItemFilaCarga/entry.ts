import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient mínimo p/ checagem de idempotência (ConsultarPedido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

async function getOmieCredentials(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  const appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  return { appKey, appSecret };
}

// Consulta a etapa atual do pedido no Omie. Retorna a etapa (string) ou null se não der pra consultar.
async function consultarEtapaOmie(base44, item) {
  try {
    const { appKey, appSecret } = await getOmieCredentials(base44);
    if (!appKey || !appSecret) return null;
    const param = {};
    if (item.codigo_pedido_omie) param.codigo_pedido = Number(item.codigo_pedido_omie);
    else if (item.codigo_pedido_integracao) param.codigo_pedido_integracao = String(item.codigo_pedido_integracao);
    else return null;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(OMIE_BASE_URL + 'produtos/pedido/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ConsultarPedido', app_key: appKey, app_secret: appSecret, param: [param] }),
      signal: controller.signal
    });
    clearTimeout(tid);
    const data = await res.json();
    if (data.faultstring) return null; // qualquer erro de consulta → processa normalmente
    return String(data?.pedido_venda_produto?.cabecalho?.etapa || data?.cabecalho?.etapa || '');
  } catch {
    return null;
  }
}

// Reseta um item da fila para reprocessamento (mantendo a carga). Antes, checa idempotência:
// se o pedido já está na etapa de destino no Omie, marca concluído sem reenfileirar.
async function resetarItem(base44, item) {
  // Idempotência: se já está na etapa destino (ou além), conclui sem reprocessar.
  const etapaAtual = await consultarEtapaOmie(base44, item);
  const destino = String(item.etapa_destino || '50');
  if (etapaAtual && Number(etapaAtual) >= Number(destino)) {
    await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
      status: 'concluido',
      processado_em: new Date().toISOString(),
      erro_log: '',
      proxima_tentativa_em: null
    }).catch(() => {});
    return { id: item.id, ja_concluido: true };
  }
  await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
    status: 'pendente',
    tentativas: 0,
    tentativas_redundante: 0,
    erro_log: '',
    proxima_tentativa_em: null
  }).catch(() => {});
  return { id: item.id, reenfileirado: true };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { item_id, carga_id, apenas_erros = true } = body;

    if (!item_id && !carga_id) {
      return Response.json({ error: 'Informe item_id ou carga_id' }, { status: 400 });
    }

    // Monta a lista de itens a reenviar.
    let itens = [];
    if (item_id) {
      const it = await base44.asServiceRole.entities.FilaCargaOmie.get(item_id).catch(() => null);
      if (!it) return Response.json({ error: 'Item da fila não encontrado' }, { status: 404 });
      itens = [it];
    } else {
      const daCarga = await base44.asServiceRole.entities.FilaCargaOmie.filter({ carga_id }, '-created_date', 500).catch(() => []);
      itens = apenas_erros ? daCarga.filter(i => i.status === 'erro') : daCarga.filter(i => i.status !== 'concluido');
    }

    if (!itens.length) {
      return Response.json({ sucesso: true, reenfileirados: 0, ja_concluidos: 0, mensagem: 'Nenhum item para reenviar' });
    }

    let reenfileirados = 0;
    let jaConcluidos = 0;
    for (const it of itens) {
      const r = await resetarItem(base44, it);
      if (r.ja_concluido) jaConcluidos++;
      else reenfileirados++;
    }

    // Dispara o worker em background (não espera a conclusão).
    if (reenfileirados > 0) {
      base44.functions.invoke('processarFilaCargaOmie', {}).catch(() => {});
    }

    return Response.json({
      sucesso: true,
      reenfileirados,
      ja_concluidos: jaConcluidos,
      mensagem: `${reenfileirados} pedido(s) reenviado(s) para processamento${jaConcluidos > 0 ? `, ${jaConcluidos} já estava(m) concluído(s)` : ''}.`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});