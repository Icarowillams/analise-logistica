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
const PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

async function getCredenciais(base44) {
  const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  if (configs?.[0]?.app_key && configs?.[0]?.app_secret) return { app_key: configs[0].app_key, app_secret: configs[0].app_secret };
  const key = Deno.env.get('OMIE_APP_KEY');
  const secret = Deno.env.get('OMIE_APP_SECRET');
  if (key && secret) return { app_key: key, app_secret: secret };
  throw new Error('Credenciais Omie não configuradas');
}

);
  return omieCall(base44, 'produtos/pedidovendafat/', param, { call: callOrEndpoint });
}) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
  const creds = await getCredenciais(base44);
  const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
  if (cacheMinutes > 0) {
    const caches = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
    if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
  }
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: creds.app_key, app_secret: creds.app_secret, param: [param] }) });
    const data = await res.json();
    if (data.faultstring || data.faultcode) {
      const msg = String(data.faultstring || '').toLowerCase();
      if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('indispon')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
      throw new Error(data.faultstring || 'Erro Omie');
    }
    if (cacheMinutes > 0) {
      const payloadCache = { chave, valor: data, tipo: call, expira_em: new Date(Date.now() + cacheMinutes * 60000).toISOString(), criado_em: new Date().toISOString() };
      const existente = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
      if (existente?.[0]?.id) await base44.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payloadCache).catch(() => {}); else await base44.asServiceRole.entities.CacheOmieConsulta.create(payloadCache).catch(() => {});
    }
    if (logIntegration) await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'sucesso', payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

function pickId(detalhe, body) {
  return body.nIdNF || body.nIdNfe || detalhe?.compl?.nIdNF || detalhe?.nIdNF || detalhe?.nCodNF || null;
}

function nfChaveFromBody(body) {
  const chave = {};
  if (body.nIdNF) chave.nCodNF = Number(body.nIdNF);
  if (body.nCodNF) chave.nCodNF = Number(body.nCodNF);
  if (body.nNF) chave.nNF = String(body.nNF);
  if (body.cNumero) chave.nNF = String(body.cNumero);
  return chave;
}

function downloadDataUrl(content, mime) {
  if (!content) return null;
  if (/^https?:\/\//i.test(String(content))) return content;
  return `data:${mime};charset=utf-8,${encodeURIComponent(String(content))}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const chaveNF = nfChaveFromBody(body);
    if (!chaveNF.nCodNF && !chaveNF.nNF && !body.nIdPedido && !body.codigo_pedido) {
      return Response.json({ error: 'Informe nIdNF/nCodNF, número da NF ou pedido' }, { status: 400 });
    }

    const t0 = Date.now();
    let detalhe = null;
    let detalheErro = null;

    try {
      detalhe = await omieCall(base44, NF_URL, 'ConsultarNF', chaveNF, { cacheMinutes: 5 });
    } catch (e) {
      detalheErro = e.message;
    }

    const nIdNfe = pickId(detalhe, body);
    const nIdPedido = body.nIdPedido || detalhe?.compl?.nIdPedido || detalhe?.nIdPedido || null;

    const chamadas = [];
    if (nIdNfe) {
      chamadas.push(['nfe_completa', omieCall(base44, DFE_URL, 'ObterNfe', { nIdNfe: Number(nIdNfe) }, { cacheMinutes: 5 })]);
      chamadas.push(['danfe_simplificado', omieCall(base44, DFE_URL, 'ObterDanfeSimp', { nIdNfe: Number(nIdNfe) }, { cacheMinutes: 5 })]);
    }
    if (nIdPedido) {
      chamadas.push(['pedido_pdf', omieCall(base44, DFE_URL, 'ObterPedVenda', { nIdPed: Number(nIdPedido) }, { cacheMinutes: 5 })]);
      chamadas.push(['pedido_completo', omieCall(base44, PEDIDO_URL, 'ConsultarPedido', { codigo_pedido: Number(nIdPedido) }, { cacheMinutes: 5 })]);
    }

    const resultados = await Promise.allSettled(chamadas.map(([, promise]) => promise));
    const extras = {};
    const erros = { detalhe: detalheErro };

    chamadas.forEach(([nome], index) => {
      const r = resultados[index];
      if (r.status === 'fulfilled') extras[nome] = r.value;
      else erros[nome] = r.reason?.message || 'Falha na consulta';
    });

    const nfe = extras.nfe_completa || {};
    const danfeSimp = extras.danfe_simplificado || {};
    const pedidoPdf = extras.pedido_pdf || {};

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/nfconsultar + produtos/dfedocs + produtos/pedido',
      call: 'ConsultarNF + ObterNfe + ObterDanfeSimp + ObterPedVenda + ConsultarPedido',
      operacao: 'extrair_nfe_completa',
      status: 'sucesso',
      duracao_ms: Date.now() - t0,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      ids: { nIdNfe, nIdPedido },
      resumo: {
        numero: detalhe?.ide?.nNF || nfe.cNumNfe || body.cNumero || body.nNF || '',
        chave: detalhe?.compl?.cChaveNFe || nfe.nChaveNfe || '',
        emissao: detalhe?.ide?.dEmi || nfe.dDataEmisNfe || '',
        valor: detalhe?.total?.ICMSTot?.vNF || null,
        cliente: detalhe?.nfDestInt?.cRazao || ''
      },
      detalhe_nf: detalhe,
      dfe: {
        nfe_completa: extras.nfe_completa || null,
        xml: nfe.cXmlNfe || null,
        pdf_danfe: nfe.cPdf || null,
        portal: nfe.cLinkPortal || null,
        danfe_simplificado: danfeSimp.cPdf || null,
        pedido_pdf: pedidoPdf.cPdfPed || null,
        xml_download_url: downloadDataUrl(nfe.cXmlNfe, 'application/xml')
      },
      pedido_completo: extras.pedido_completo || null,
      bruto: extras,
      erros
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});