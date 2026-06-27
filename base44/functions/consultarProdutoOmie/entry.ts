import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

// Environment-First SEM cache: Deno.env é atômico e sem TTL — nunca serve chave velha durante
// troca de credencial. ConfiguracaoOmie é só fallback.
async function getOmieCredentials(base44: any) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

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
    const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
    const controle = cb?.[0];
    if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
        const err = new Error(`API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`);
        err.code = 'OMIE_425';
        err.bloqueado_ate = controle.bloqueado_ate;
        throw err;
    }
    return controle;
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

        // Circuit breaker — aborta antes de qualquer chamada (omieCall também reverifica por chamada)
        await checarBloqueio(base44);

        // Deduplicação por código — evita chamadas redundantes ao Omie no mesmo lote
        const codigosUnicos = [...new Set(codigos.map(c => String(c)))];

        for (const codigo of codigosUnicos) {
            const cached = getProdutoCached(codigo);
            if (cached) {
                resultados[codigo] = cached;
                continue;
            }

            // Chamada via gateway canônico — retry/backoff + circuit breaker (425) embutidos
            let data = null;
            try {
                data = await omieCall(base44, 'geral/produtos/', { codigo }, { call: 'ConsultarProduto', skipLog: true });
            } catch (e: any) {
                if (e?.message && /bloquead|consumo indevido|425/i.test(e.message)) {
                    const err = new Error(e.message); err.code = 'OMIE_425'; throw err;
                }
                resultados[codigo] = { erro: e.message };
                await new Promise(r => setTimeout(r, 600));
                continue;
            }

            {
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