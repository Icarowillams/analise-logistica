import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache = null;
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = Deno.env.get('OMIE_APP_KEY') || cfg?.app_key || '';
  let appSecret = Deno.env.get('OMIE_APP_SECRET') || cfg?.app_secret || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

async function omieCall(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) return { faultstring: data.faultstring };
      return data;
    } catch (e) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * DIAGNÓSTICO (somente leitura — não altera nada).
 * Pega espelhos em etapa 20/50 e consulta a situação real de cada pedido no Omie,
 * classificando: cancelado, inexistente (excluído), ou etapa real diferente.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Apenas admin' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const LIMITE = Math.min(Math.max(Number(body.limite) || 6, 1), 20);

    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
      { etapa: { $in: ['20', '50'] } }, '-sincronizado_em', LIMITE
    );

    const resultados = [];
    for (const esp of espelhos || []) {
      const cod = String(esp.codigo_pedido || '');
      if (!cod) continue;

      let resp;
      try {
        resp = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(cod) }, { call: 'ConsultarPedido', timeoutMs: 20000 });
      } catch (err) {
        const msg = String(err?.message || '');
        if (/bloqueada/i.test(msg)) {
          return Response.json({ sucesso: false, abortado: true, motivo: 'API Omie bloqueada — tente mais tarde.', diagnosticados: resultados.length, resultados });
        }
        resultados.push({ codigo_pedido: cod, numero_pedido: esp.numero_pedido, erro: msg.slice(0, 120) });
        await sleep(1500);
        continue;
      }

      const fault = String(resp?.faultstring || '');
      if (fault) {
        const inexistente = /n[ãa]o existem registros|n[ãa]o cadastrad/i.test(fault);
        resultados.push({
          codigo_pedido: cod,
          numero_pedido: esp.numero_pedido,
          situacao: inexistente ? 'INEXISTENTE_NO_OMIE (excluído)' : 'fault',
          faultstring: fault.slice(0, 160)
        });
        await sleep(1200);
        continue;
      }

      const cab = resp?.pedido_venda_produto?.cabecalho || {};
      const info = resp?.pedido_venda_produto?.infoCadastro || {};
      resultados.push({
        codigo_pedido: cod,
        numero_pedido: esp.numero_pedido,
        etapa_espelho: esp.etapa,
        etapa_real_omie: String(cab.etapa || ''),
        cancelado_flag: cab.cancelado ?? info.cancelado ?? null,
        status_pedido: cab.status_pedido || '',
        denegado: info.denegado ?? null,
        bloqueado: info.bloqueado ?? null
      });
      await sleep(1200);
    }

    return Response.json({ sucesso: true, total: resultados.length, resultados });
  } catch (error) {
    return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
  }
});