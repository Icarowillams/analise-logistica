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
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
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
  // SEM retries automáticos para impressão de PDF — cada retry gasta cota e agrava o rate limit.
  // Se falhar, retorna erro imediato e o frontend tenta de novo com delay adequado.
  let lastErr = '';
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 20000);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
    clearTimeout(tid);
    const data = await res.json();
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
        { const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null); }
        throw new Error(data.faultstring);
      }
      // Erro de rate limit: retorna imediato — NÃO faz retry (economiza cota)
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite')) {
        // Extrai segundos para informar o frontend
        const waitMatch = String(data.faultstring).match(/(\d+)\s*segundo/i);
        const waitSecs = waitMatch ? Number(waitMatch[1]) : 60;
        const err = new Error(data.faultstring);
        err.retryAfterSecs = waitSecs;
        throw err;
      }
      throw new Error(data.faultstring);
    }
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
    return data;
  } catch (e: any) {
    lastErr = e.message;
    if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
    const err = new Error(lastErr);
    if (e.retryAfterSecs) err.retryAfterSecs = e.retryAfterSecs;
    throw err;
  }
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
    const { nIdNF, nCodNF, nNF, nIdPedido } = body;

    // Resolver o nIdNfe (id interno do Omie usado em ObterNfe/dfedocs)
    // IMPORTANTE: nIdNF/nCodNF vindos do ListarNF (nfconsultar) NÃO são o mesmo
    // que nIdNfe do ObterNfe (dfedocs). Precisamos resolver via ConsultarNF.
    let nIdNfe = null;

    // Estratégia 1: se já temos nIdNF numérico válido, tenta direto (1 chamada)
    const candidato = Number(nIdNF || nCodNF || 0);
    if (candidato > 0) {
      // Tenta usar direto — se ObterNfe falhar, cairá no fallback abaixo
      try {
        const nfe = await omieCall(base44, DFE_URL, { nIdNfe: candidato }, { call: 'ObterNfe', skipLog: true });
        if (nfe?.cPdf) {
          // Sucesso — já temos o PDF, baixa e retorna
          const pdfRes = await fetch(nfe.cPdf);
          if (!pdfRes.ok) return Response.json({ error: `Falha ao baixar PDF (HTTP ${pdfRes.status})` }, { status: 502 });
          const buf = await pdfRes.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          return Response.json({ sucesso: true, numero: nfe?.cNumNfe || nNF || '', chave: nfe?.nChaveNfe || '', pdf_base64: btoa(binary), pdf_url: nfe.cPdf });
        }
        // ObterNfe retornou mas sem cPdf — pode ser NF errada, tenta fallback
      } catch {
        // nIdNF não é o nIdNfe correto para dfedocs — segue para fallback
      }
    }

    // Estratégia 2 (principal): resolver via ConsultarNF usando nNF (número da nota)
    if (!nIdNfe && nNF) {
      const detalhe = await omieCall(base44, NF_URL, { nNF: String(nNF) }, { call: 'ConsultarNF', skipLog: true });
      nIdNfe = detalhe?.compl?.nIdNF || detalhe?.nIdNF || detalhe?.nCodNF || null;
    }

    if (!nIdNfe) {
      return Response.json({ error: 'Não foi possível resolver o ID da NF. Informe nNF (número da nota).' }, { status: 400 });
    }

    const nfe = await omieCall(base44, DFE_URL, { nIdNfe: Number(nIdNfe) }, { call: 'ObterNfe', skipLog: true });
    const pdfUrl = nfe?.cPdf || null;

    if (!pdfUrl) {
      // Verificar se a NF existe mas ainda não tem PDF (pendente SEFAZ)
      const temChave = !!nfe?.nChaveNfe;
      const temXml = !!nfe?.cXmlNfe;
      const statusOmie = nfe?.cDesStatus || '';
      
      if (temChave && !temXml) {
        // NF tem chave mas sem XML/PDF — ainda sendo processada pela SEFAZ
        return Response.json({ 
          sucesso: false,
          error: `NF ${nfe?.cNumNfe || nNF} ainda aguardando processamento SEFAZ. O DANFE será disponibilizado em breve.`,
          motivo: 'aguardando_sefaz',
          numero: nfe?.cNumNfe || nNF || '',
          chave: nfe?.nChaveNfe || ''
        }, { status: 202 });
      }
      
      return Response.json({ 
        sucesso: false,
        error: 'PDF DANFE não disponível no Omie para esta NF',
        motivo: 'pdf_indisponivel',
        numero: nfe?.cNumNfe || nNF || '',
        status_omie: statusOmie
      }, { status: 404 });
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