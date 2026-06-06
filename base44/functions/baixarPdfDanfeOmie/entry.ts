// Baixa o PDF do DANFE de uma NF-e do Omie.
// Usa ObterNfe (endpoint produtos/dfedocs) com nIdNfe para obter cPdf (URL do DANFE),
// faz o fetch no servidor (evita CORS) e devolve em base64.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.omie_app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.omie_app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const until = new Date(Date.now() + 30 * 60000).toISOString();
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: 'principal', bloqueado: true, bloqueado_ate: until, ultimo_erro: data.faultstring, atualizado_em: new Date().toISOString() }).catch(() => null);
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

const NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const DFE_URL = 'https://app.omie.com.br/api/v1/produtos/dfedocs/';

async function getCredenciais(base44) {
  const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  if (configs?.[0]?.app_key && configs?.[0]?.app_secret) return { app_key: configs[0].app_key, app_secret: configs[0].app_secret };
  const key = Deno.env.get('OMIE_APP_KEY');
  const secret = Deno.env.get('OMIE_APP_SECRET');
  if (key && secret) return { app_key: key, app_secret: secret };
  throw new Error('Credenciais Omie não configuradas');
}


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { nIdNF, nCodNF, nNF } = body;

    // Resolver o nIdNfe (id interno do Omie usado em ObterNfe)
    let nIdNfe = Number(nIdNF || nCodNF || 0) || null;

    if (!nIdNfe) {
      // Buscar via ConsultarNF (nfconsultar) usando nNF
      if (!nNF) return Response.json({ error: 'Informe nIdNF, nCodNF ou nNF' }, { status: 400 });
      const detalhe = await omieCall(base44, NF_URL, 'ConsultarNF', { nNF: String(nNF) }, { cacheMinutes: 0 });
      nIdNfe = detalhe?.compl?.nIdNF || detalhe?.nIdNF || detalhe?.nCodNF || null;
      if (!nIdNfe) return Response.json({ error: 'nIdNfe não encontrado para a NF informada' }, { status: 404 });
    }

    const nfe = await omieCall(base44, DFE_URL, 'ObterNfe', { nIdNfe: Number(nIdNfe) }, { cacheMinutes: 0 });
    const pdfUrl = nfe?.cPdf || null;

    if (!pdfUrl) {
      return Response.json({ error: 'PDF DANFE não disponível no Omie para esta NF' }, { status: 404 });
    }

    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) {
      return Response.json({ error: `Falha ao baixar PDF do Omie (HTTP ${pdfRes.status})` }, { status: 502 });
    }
    const buf = await pdfRes.arrayBuffer();
    // Converte para base64 em chunks (evita estouro de stack com PDFs grandes)
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    return Response.json({
      sucesso: true,
      numero: nfe?.cNumNfe || nNF || '',
      chave: nfe?.nChaveNfe || '',
      pdf_base64: base64,
      pdf_url: pdfUrl
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});