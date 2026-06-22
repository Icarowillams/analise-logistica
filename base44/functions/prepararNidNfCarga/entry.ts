// Pré-aquecimento do cache de nIdNF de uma carga.
// Lê do LogEmissaoNF as NFs autorizadas da carga que AINDA NÃO têm nid_nf, resolve
// cada uma via ConsultarNF { nNF }, e grava nid_nf + chave_nfe no LogEmissaoNF.
// Idempotente, espaçado (~600ms), respeita circuit breaker. NÃO emite/altera nada.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const NF_URL = OMIE_BASE_URL + 'produtos/nfconsultar/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

let _credsCache = null;
async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  _credsCache = { appKey, appSecret, at: Date.now() };
  return _credsCache;
}

async function circuitBloqueado(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return false;
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) return false;
  return true;
}

async function consultarNf(base44, nNF) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 20000);
  const res = await fetch(NF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call: 'ConsultarNF', app_key: appKey, app_secret: appSecret, param: [{ nNF: Number(nNF) }] }),
    signal: controller.signal
  });
  clearTimeout(tid);
  if (res.status === 425 || res.status === 429 || res.status >= 500) {
    const e = new Error(`HTTP ${res.status} Omie`);
    e.rateLimited = true;
    throw e;
  }
  const d = await res.json();
  if (d?.faultstring) {
    const msg = String(d.faultstring).toLowerCase();
    if (msg.includes('consumo') || msg.includes('redundante') || msg.includes('cota') || msg.includes('aguarde') || msg.includes('bloque')) {
      const e = new Error(d.faultstring);
      e.rateLimited = true;
      throw e;
    }
    throw new Error(d.faultstring);
  }
  return {
    nId: d?.compl?.nIdNF || d?.nIdNF || d?.nCodNF || null,
    chave: d?.compl?.cChaveNFe || d?.nfDestInt?.cChaveNFe || d?.cChaveNFe || ''
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    let { carga_id, numero_carga } = body;

    if (!numero_carga && carga_id) {
      const c = await base44.asServiceRole.entities.Carga.filter({ id: carga_id }, '-created_date', 1).catch(() => []);
      numero_carga = c?.[0]?.numero_carga || null;
    }

    // Logs autorizados da carga (por numero_carga; fallback carga_id)
    let logs = [];
    if (numero_carga) logs = await base44.asServiceRole.entities.LogEmissaoNF.filter({ numero_carga: String(numero_carga), status: 'autorizada' }, '-created_date', 500).catch(() => []);
    if ((!logs || logs.length === 0) && carga_id) logs = await base44.asServiceRole.entities.LogEmissaoNF.filter({ carga_id, status: 'autorizada' }, '-created_date', 500).catch(() => []);

    // Só os que faltam cache E têm número de NF
    const pendentes = (logs || []).filter(l => !l.nid_nf && String(l.numero_nf || '').replace(/\D/g, ''));
    const total = pendentes.length;

    if (total === 0) {
      return Response.json({ sucesso: true, total: 0, processados: 0, mensagem: 'Cache já completo' });
    }

    let processados = 0;
    let bloqueado = false;
    for (const log of pendentes) {
      if (await circuitBloqueado(base44)) { bloqueado = true; break; }
      const numNf = String(log.numero_nf || '').replace(/\D/g, '');
      try {
        const { nId, chave } = await consultarNf(base44, numNf);
        if (nId) {
          const patch = { nid_nf: String(nId) };
          if (chave) patch.chave_nfe = String(chave);
          await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, patch).catch(() => null);
          processados++;
        }
      } catch (e) {
        if (e.rateLimited) { bloqueado = true; break; } // para e retoma depois — sem erro fatal
        // erro pontual de uma NF: pula e segue
      }
      await sleep(600); // espaçamento seguro sob o rate limit
    }

    return Response.json({ sucesso: true, total, processados, bloqueado, restantes: total - processados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});