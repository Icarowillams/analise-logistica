import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
        return { blocked: false };
    }
    return { blocked: true, blockedUntil: c.bloqueado_ate };
}

// omieCall canônico (canal único ao Omie). Auto-contido. Em faultstring NÃO lança: devolve o
// objeto bruto do Omie (com faultstring/faultcode) para preservar a lógica existente desta função,
// que classifica códigos de erro/duplicidade. Só registra circuit breaker em bloqueio/425.
async function omieCall(base44, endpoint, param, options = {}) {
    const { appKey, appSecret } = await getOmieCredentials(base44);
    const call = options.call || '';
    if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
    if (!call) throw new Error('Informe options.call com o método Omie.');
    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
    const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
    const RETRIES = [2500, 5000];
    for (let i = 0; i <= RETRIES.length; i++) {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
        let res;
        try {
            res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
        } catch (e) {
            clearTimeout(tid);
            if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
            return { faultstring: e.name === 'AbortError' ? 'Timeout na chamada Omie' : e.message };
        }
        clearTimeout(tid);
        if (res.status >= 500 || res.status === 429) {
            const corpo = await res.text().catch(() => '');
            if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
            return { faultstring: `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}` };
        }
        if (res.status === 425) {
            const corpo = await res.text().catch(() => '');
            const _rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
            const _cb = _rows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
            const _p = { erros_consecutivos: _erros, ultimo_erro: `HTTP 425${corpo ? ': ' + corpo.slice(0, 200) : ''}`, atualizado_em: new Date().toISOString() };
            if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
            await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
            return { faultstring: `HTTP 425 — consumo indevido${corpo ? ': ' + corpo.slice(0, 200) : ''}`, faultcode: '425' };
        }
        const data = await res.json().catch(() => ({ faultstring: 'Resposta Omie inválida' }));
        if (data.faultstring) {
            const msg = String(data.faultstring).toLowerCase();
            const isBlocked = msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde') || msg.includes('consumo indevido');
            const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon');
            if (isBlocked) {
                const _rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
                const _cb = _rows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
                const _secs = (() => { const m = String(data.faultstring).match(/(\d+)\s*segundo/i); return m ? Math.min(Number(m[1]), 1800) : 0; })();
                const _p = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() };
                if (_erros >= _thresh && _secs > 0) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + _secs * 1000).toISOString(); }
                await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
                return data;
            }
            if (isRate && i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
            return data;
        }
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
        return data;
    }
    return { faultstring: 'Máximo de tentativas Omie excedido' };
}

async function logOmie(base44, payload) {
    try {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create(payload);
    } catch (_) { /* log best-effort */ }
}

function removeQuotes(val) {
    if (typeof val !== 'string') return val;
    let v = val.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

function cleanStrings(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = typeof v === 'string' ? removeQuotes(v) : v;
    }
    return out;
}

function mapearProdutoParaOmie(produto, unidadeSigla) {
    const ncm = (produto.ncm || '').replace(/\D/g, '') || '19059090';
    const cest = (produto.cest || '').replace(/\D/g, '');
    const codigo = String(produto.codigo || '').trim();

    // NCM precisa ter exatamente 8 dígitos para Omie aceitar
    const ncm8 = ncm.padStart(8, '0').substring(0, 8);

    const produtoOmie = {
        codigo_produto_integracao: codigo,
        codigo: codigo.substring(0, 60),
        descricao: (produto.nome || 'Produto sem nome').trim().substring(0, 120),
        unidade: (unidadeSigla || 'UN').substring(0, 6).toUpperCase(),
        ncm: ncm8,
        tipoItem: '00', // 00 = Mercadoria para Revenda (padrão geral)
        peso_bruto: Number(produto.peso) || 0,
        peso_liq: Number(produto.peso) || 0,
        bloqueado: produto.status === 'inativo' ? 'S' : 'N',
        bloquear_exclusao: 'N',
        inativo: produto.status === 'inativo' ? 'S' : 'N'
    };

    if (cest) produtoOmie.cest = cest.substring(0, 9);

    if (produto.cod_barras && String(produto.cod_barras).trim()) {
        produtoOmie.ean = String(produto.cod_barras).replace(/\D/g, '').substring(0, 14);
    }

    // Descrição detalhada (se houver)
    if (produto.descricao && produto.descricao.trim()) {
        produtoOmie.descr_detalhada = produto.descricao.trim().substring(0, 2000);
    }

    return produtoOmie;
}

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    let entidadeId = null;
    let produtoData = null;

    try {
        const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
        const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

        if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
            return Response.json({
                sucesso: false,
                erro: 'OMIE_APP_KEY ou OMIE_APP_SECRET não configurados'
            });
        }

        const body = await req.json();
        const { event, data } = body;
        produtoData = data;
        entidadeId = event?.entity_id || data?.id;

        // Recarregar se payload_too_large ou campos ausentes
        if ((body.payload_too_large || !produtoData || !produtoData.nome || !produtoData.codigo) && entidadeId) {
            produtoData = await base44.asServiceRole.entities.Produto.get(entidadeId);
        }

        if (!produtoData || !entidadeId) {
            return Response.json({ sucesso: false, erro: 'Produto não informado' }, { status: 400 });
        }

        if (!produtoData.id) produtoData.id = entidadeId;

        // Validações mínimas
        if (!produtoData.nome || !produtoData.codigo) {
            const erro = 'Produto precisa de nome e codigo';
            await logOmie(base44, {
                endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
                entidade_tipo: 'Produto', entidade_id: entidadeId,
                status: 'erro', mensagem_erro: erro, tentativas: 1
            });
            return Response.json({ sucesso: false, erro, produto_id: entidadeId });
        }

        // Ignorar tipos que não sobem ao Omie
        if (produtoData.tipo === 'bonificacao') {
            await logOmie(base44, {
                endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
                entidade_tipo: 'Produto', entidade_id: entidadeId,
                status: 'warning', mensagem_erro: 'Produto tipo=bonificacao: não envia ao Omie',
                tentativas: 1
            });
            return Response.json({ sucesso: false, pulado: true, motivo: 'bonificacao', produto_id: entidadeId });
        }

        produtoData = cleanStrings(produtoData);

        // Buscar sigla da unidade de medida
        let unidadeSigla = 'UN';
        if (produtoData.unidade_medida_id) {
            try {
                const unidade = await base44.asServiceRole.entities.UnidadeMedida.get(produtoData.unidade_medida_id);
                if (unidade?.nome) unidadeSigla = unidade.nome;
            } catch (_) { /* fallback UN */ }
        }

        const produtoOmie = mapearProdutoParaOmie(produtoData, unidadeSigla);

        // Pré-consulta: busca o produto no Omie pelo código interno (campo "codigo" = "11", "12", etc.)
        // Este campo é o mais confiável pois é único e imutável no Omie.
        // Se já temos o codigo_produto numérico salvo, usamos ele diretamente.
        try {
            const codigoOmieLocal = produtoData.codigo_omie ? Number(produtoData.codigo_omie) : null;
            const paramConsulta = codigoOmieLocal
                ? { codigo_produto: codigoOmieLocal }
                : { codigo: produtoOmie.codigo }; // busca pelo código interno (ex: "11")
            const achado = await omieCall(base44, 'geral/produtos/', paramConsulta, { call: 'ConsultarProduto', skipLog: true });
            if (achado?.codigo_produto) {
                // Produto encontrado: injeta o ID numérico para forçar UPDATE em vez de INSERT
                produtoOmie.codigo_produto = achado.codigo_produto;
                // Mantém o codigo_produto_integracao que o Omie já conhece (não sobrescreve com ID do Base44)
                if (achado.codigo_produto_integracao) {
                    produtoOmie.codigo_produto_integracao = achado.codigo_produto_integracao;
                }
                // Persiste o codigo_produto no Base44 para evitar pré-consulta nas próximas vezes
                if (!codigoOmieLocal) {
                    await base44.asServiceRole.entities.Produto.update(entidadeId, {
                        codigo_omie: String(achado.codigo_produto)
                    }).catch(() => {});
                }
            }
        } catch (_) { /* pré-consulta é best-effort — UpsertProduto tentará criar */ }

        const started = Date.now();
        const resultado = await omieCall(base44, 'geral/produtos/', produtoOmie, { call: 'UpsertProduto', skipLog: true });
        const duracao_ms = Date.now() - started;

        if (resultado.faultstring || resultado.faultcode) {
            await logOmie(base44, {
                endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
                entidade_tipo: 'Produto', entidade_id: entidadeId,
                status: 'erro',
                codigo_erro: resultado.faultcode,
                mensagem_erro: resultado.faultstring,
                payload_enviado: JSON.stringify(produtoOmie).slice(0, 2000),
                payload_resposta: JSON.stringify(resultado).slice(0, 2000),
                duracao_ms, tentativas: 1
            });
            return Response.json({
                sucesso: false,
                erro: resultado.faultstring || 'Falha Omie',
                codigo_erro: resultado.faultcode,
                produto_id: entidadeId
            });
        }

        // Gravar codigo_omie no Base44
        if (resultado.codigo_produto) {
            try {
                await base44.asServiceRole.entities.Produto.update(entidadeId, {
                    codigo_omie: String(resultado.codigo_produto)
                });
            } catch (e) {
                console.log('[enviarProdutoOmie] Falha ao gravar codigo_omie:', e.message);
            }
        }

        await logOmie(base44, {
            endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
            entidade_tipo: 'Produto', entidade_id: entidadeId,
            status: 'sucesso',
            payload_enviado: JSON.stringify(produtoOmie).slice(0, 2000),
            payload_resposta: JSON.stringify(resultado).slice(0, 2000),
            duracao_ms, tentativas: 1
        });

        return Response.json({
            sucesso: true,
            produto_id: entidadeId,
            codigo_omie: resultado.codigo_produto,
            mensagem: resultado.descricao_status || 'Produto enviado com sucesso'
        });

    } catch (error) {
        await logOmie(base44, {
            endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
            entidade_tipo: 'Produto', entidade_id: entidadeId,
            status: 'erro', mensagem_erro: error.message, tentativas: 1
        });
        return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
    }
});