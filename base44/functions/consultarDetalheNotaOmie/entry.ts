import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = String(cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '').trim();
  let appSecret = String(cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (!appKey || !appSecret) { appKey = (Deno.env.get('OMIE_APP_KEY') || '').trim(); appSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim(); }
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
      // Tratamento de status HTTP ANTES de res.json() — num 5xx/429 o corpo não costuma ser JSON.
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 425) {
          const _cbId = '6a1e06a9aa62ceab7b3b6d97';
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p: any = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        // Erros ESTRUTURAIS (parâmetro/chave inválida, tag fora da estrutura) são TERMINAIS:
        // falham 100% das vezes, então NÃO faz retry — só desperdiça cota e polui o log do Omie.
        const ehTerminal = msg.includes('chave de acesso') || msg.includes('chave inválid') || msg.includes('chave invalid') || msg.includes('acesso está inválid') || msg.includes('acesso esta invalid') || msg.includes('não faz parte da estrutura') || msg.includes('nao faz parte da estrutura') || msg.includes('5001');
        if (!ehTerminal && (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error'))) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
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

// Resolve o ID interno (nCodNF) a partir do NÚMERO da NF (nNF), via ConsultarNF.
// ConsultarNF aceita { nNF } SOZINHO e devolve compl.nIdNF na hora — 1 chamada, sem varredura.
async function resolverNCodNfPorNumero(base44: any, nNF: any) {
  const alvo = String(nNF || '').replace(/\D/g, '');
  if (!alvo) return null;
  const d = await omieCall(base44, NF_URL, { nNF: Number(alvo) }, { call: 'ConsultarNF', skipLog: true });
  return d?.compl?.nIdNF || d?.nIdNF || d?.nCodNF || null;
}

async function getCredenciais(base44) {
  const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  if (configs?.[0]?.app_key && configs?.[0]?.app_secret) return { app_key: String(configs[0].app_key).trim(), app_secret: String(configs[0].app_secret).trim() };
  const key = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const secret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (key && secret) return { app_key: key, app_secret: secret };
  throw new Error('Credenciais Omie não configuradas');
}


function pickId(detalhe, body) {
  return body.nIdNF || body.nIdNfe || detalhe?.compl?.nIdNF || detalhe?.nIdNF || detalhe?.nCodNF || null;
}

function nfChaveFromBody(body) {
  const chave: any = {};
  // ConsultarNF (produtos/nfconsultar) SÓ aceita o ID interno nCodNF.
  // O campo nNF (número da nota) NÃO faz parte da estrutura → erro 5001.
  // Por isso só montamos a chave quando temos o ID interno; o número da NF (cNumero)
  // é apenas rótulo de exibição, nunca filtro de API.
  const id = Number(body.nIdNF || body.nCodNF || 0);
  if (id > 0) chave.nCodNF = id;
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
    let chaveNF = nfChaveFromBody(body);
    // Lista vinda da fonte LOCAL não traz ID interno — só nNF. Resolve o ID pelo número.
    if (!chaveNF.nCodNF && (body.nNF || body.cNumero)) {
      const resolvido = await resolverNCodNfPorNumero(base44, body.nNF || body.cNumero).catch(() => null);
      if (resolvido) chaveNF = { nCodNF: Number(resolvido) };
    }
    if (!chaveNF.nCodNF) {
      return Response.json({ error: 'Informe o ID interno da NF (nIdNF/nCodNF). O número da NF (cNumero) não é aceito como filtro pela API Omie.' }, { status: 400 });
    }

    const t0 = Date.now();
    let detalhe = null;
    let detalheErro = null;

    try {
      detalhe = await omieCall(base44, NF_URL, chaveNF, { call: 'ConsultarNF', skipLog: true });
    } catch (e) {
      detalheErro = e.message;
    }

    const nIdNfe = pickId(detalhe, body);
    // nIdPedido só é legítimo se vier do próprio detalhe da NF (compl.nIdPedido) ou
    // for explicitamente enviado pelo front. NUNCA usar o ID da nota como código de
    // pedido — isso gerava "A chave de acesso está inválida" no ConsultarPedido.
    const nIdPedido = detalhe?.compl?.nIdPedido || detalhe?.nIdPedido || body.nIdPedido || null;

    const chamadas = [];
    if (nIdNfe) {
      chamadas.push(['nfe_completa', omieCall(base44, DFE_URL, { nIdNfe: Number(nIdNfe) }, { call: 'ObterNfe', skipLog: true })]);
      chamadas.push(['danfe_simplificado', omieCall(base44, DFE_URL, { nIdNfe: Number(nIdNfe) }, { call: 'ObterDanfeSimp', skipLog: true })]);
    }
    if (nIdPedido) {
      chamadas.push(['pedido_pdf', omieCall(base44, DFE_URL, { nIdPed: Number(nIdPedido) }, { call: 'ObterPedVenda', skipLog: true })]);
      chamadas.push(['pedido_completo', omieCall(base44, PEDIDO_URL, { codigo_pedido: Number(nIdPedido) }, { call: 'ConsultarPedido', skipLog: true })]);
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