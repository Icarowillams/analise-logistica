import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient mínimo p/ checagem de idempotência (ConsultarPedido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function getOmieCredentials(base44) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) return { blocked: false };
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

// omieCall canônico (canal único ao Omie). Auto-contido; usado só para leitura de idempotência.
async function omieCall(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
    clearTimeout(tid);
    if (res.status >= 500 || res.status === 429 || res.status === 425) throw new Error(`HTTP ${res.status} Omie`);
    const data = await res.json();
    if (data.faultstring) throw new Error(data.faultstring);
    return data;
  } finally {
    clearTimeout(tid);
  }
}

// Consulta a etapa atual do pedido no Omie. Retorna a etapa (string) ou null se não der pra consultar.
async function consultarEtapaOmie(base44, item) {
  try {
    const param = {};
    if (item.codigo_pedido_omie) param.codigo_pedido = Number(item.codigo_pedido_omie);
    else if (item.codigo_pedido_integracao) param.codigo_pedido_integracao = String(item.codigo_pedido_integracao);
    else return null;
    const data = await omieCall(base44, 'produtos/pedido/', param, { call: 'ConsultarPedido', skipLog: true });
    return String(data?.pedido_venda_produto?.cabecalho?.etapa || data?.cabecalho?.etapa || '');
  } catch {
    return null; // qualquer erro de consulta → processa normalmente
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