import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
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
        const bloqueadoAte = new Date(Date.now() + 30 * 60000).toISOString();
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: bloqueadoAte, ultimo_erro: data.faultstring || 'HTTP 425 consumo indevido', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
        else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'geral/produtos/', call, operacao: call, status: 'erro', codigo_erro: '425',
            mensagem_erro: data.faultstring || 'HTTP 425 — consumo indevido',
            payload_enviado: JSON.stringify(param || {}).slice(0, 2000),
            payload_resposta: JSON.stringify(data || {}).slice(0, 2000)
        }).catch(() => {});
        const err = new Error(`API Omie bloqueada por consumo indevido (HTTP 425). Desbloqueio previsto: ${new Date(bloqueadoAte).toLocaleString('pt-BR')}.`);
        err.code = 'OMIE_425';
        err.bloqueado_ate = bloqueadoAte;
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

        for (const codigo of codigos) {
            const cached = getProdutoCached(codigo);
            if (cached) {
                resultados[codigo] = cached;
                continue;
            }
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

            const data = await response.json();

            if (data.faultstring) {
                await tratar425(base44, controle, 'ConsultarProduto', { codigo }, response, data);
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