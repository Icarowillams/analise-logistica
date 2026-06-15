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
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
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

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const produtoCache = new Map();
const configCache = { value: false, expiresAt: 0 };

async function getModoEconomico(base44) {
    const now = Date.now();
    if (configCache.expiresAt > now) return configCache.value;
    const configs = await base44.asServiceRole.entities.ConfiguracaoSistema.filter({ chave: 'global' });
    configCache.value = !!configs[0]?.modo_economico;
    configCache.expiresAt = now + 60000;
    return configCache.value;
}

function getProdutoCached(codigo) {
    const item = produtoCache.get(`consultarProdutoOmie:${codigo}`);
    if (!item || item.expiresAt <= Date.now()) return null;
    return item.data;
}

function setProdutoCached(codigo, data, modoEconomico) {
    const ttl = modoEconomico ? 60 * 60 * 1000 : 30 * 60 * 1000;
    produtoCache.set(`consultarProdutoOmie:${codigo}`, { data: { ...data, origem_cache: true }, expiresAt: Date.now() + ttl });
}

// Verifica circuit breaker — lança OMIE_425 se a API estiver bloqueada
async function checarBloqueio(base44) {
    const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
    const controle = cb?.[0];
    if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
        const err = new Error(`API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`);
        err.code = 'OMIE_425';
        err.bloqueado_ate = controle.bloqueado_ate;
        throw err;
    }
    return controle;
}

// Trata erro 425 → abre circuit breaker (30min), grava log explícito e lança OMIE_425
async function tratar425(base44, controle, call, param, res, data) {
    const msg = String(data.faultstring || '').toLowerCase();
    if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloquead') || msg.includes('bloqueio')) {
        const _cbId = '6a1e06a9aa62ceab7b3b6d97';
        const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
        const _cb = _cbRows?.[0];
        const _erros = (_cb?.erros_consecutivos || 0) + 1;
        const _thresh = _cb?.threshold_erros ?? 3;
        const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() };
        if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => {});
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'geral/produtos/', call, operacao: call, status: 'erro', codigo_erro: '425',
            mensagem_erro: data.faultstring || 'HTTP 425 — consumo indevido',
            payload_enviado: JSON.stringify(param || {}).slice(0, 2000),
            payload_resposta: JSON.stringify(data || {}).slice(0, 2000)
        }).catch(() => {});
        const err = new Error(`API Omie bloqueada por consumo indevido (HTTP 425). Erro: ${String(data.faultstring).slice(0, 200)}`);
        err.code = 'OMIE_425';
        throw err;
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const codigos = body.codigos || [];

        if (codigos.length === 0) {
            return Response.json({ error: 'Informe codigos[]' }, { status: 400 });
        }

        const resultados = {};
        const modoEconomico = await getModoEconomico(base44);

        // Circuit breaker — aborta antes de qualquer chamada
        const controle = await checarBloqueio(base44);

        // Deduplicação por código — evita chamadas redundantes ao Omie no mesmo lote
        const codigosUnicos = [...new Set(codigos.map(c => String(c)))];

        for (const codigo of codigosUnicos) {
            const cached = getProdutoCached(codigo);
            if (cached) {
                resultados[codigo] = cached;
                continue;
            }

            // Chamada com retry/backoff para HTTP 500/429 (instabilidade Omie); 425 → circuit breaker
            const RETRIES = [1000, 2000, 4000];
            let data = null;
            for (let tentativa = 0; tentativa <= RETRIES.length; tentativa++) {
                const response = await fetch("https://app.omie.com.br/api/v1/geral/produtos/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: "ConsultarProduto",
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{ codigo }]
                    })
                });

                // Tratar status HTTP ANTES de .json() — num 5xx/429 o corpo não costuma ser JSON
                if (response.status >= 500 || response.status === 429 || response.status === 425) {
                    const corpo = await response.text().catch(() => '');
                    if (response.status === 425) {
                        await tratar425(base44, controle, 'ConsultarProduto', { codigo }, response, { faultstring: corpo || 'HTTP 425' });
                    }
                    if (tentativa < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[tentativa])); continue; }
                    data = { faultstring: `HTTP ${response.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}` };
                    break;
                }

                data = await response.json();
                break;
            }

            if (data.faultstring) {
                // tratar425 só inspeciona data.faultstring quando não há status 425 explícito (response já tratado no loop acima)
                await tratar425(base44, controle, 'ConsultarProduto', { codigo }, { status: 200 }, data);
                resultados[codigo] = { erro: data.faultstring };
            } else {
                resultados[codigo] = {
                    codigo: data.codigo,
                    codigo_produto: data.codigo_produto,
                    descricao: data.descricao,
                    ncm: data.ncm,
                    ean: data.ean,
                    unidade: data.unidade,
                    valor_unitario: data.valor_unitario,
                    peso_liq: data.peso_liq,
                    peso_bruto: data.peso_bruto,
                    cfop: data.cfop || null,
                    csosn: data.csosn || null,
                    cst_icms: data.cst_icms || null,
                    cst_pis: data.cst_pis || null,
                    cst_cofins: data.cst_cofins || null,
                    cst_ipi: data.cst_ipi || null,
                    origem_mercadoria: data.origem_mercadoria || null,
                    tipo_item: data.tipo_item || null,
                    inativo: data.inativo,
                    tipoItem: data.tipoItem || null,
                    recomendacoes_fiscais: data.recomendacoes_fiscais || null,
                    modalidade_icms: data.modalidade_icms || null,
                    csosn_icms: data.csosn_icms || null,
                    aliquota_icms: data.aliquota_icms || null,
                    codigo_beneficio: data.codigo_beneficio || null,
                    dadosIbpt: data.dadosIbpt || null,
                    bloqueado: data.bloqueado || null,
                    cache_hit: false,
                    // Raw completo para comparação
                    _raw: data,
                };
                setProdutoCached(codigo, resultados[codigo], modoEconomico);
            }

            await new Promise(r => setTimeout(r, 600));
        }

        return Response.json({ sucesso: true, resultados });

    } catch (error) {
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});