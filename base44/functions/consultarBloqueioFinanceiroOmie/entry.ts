import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const cache = new Map();
const configCache = { value: false, expiresAt: 0 };

async function getModoEconomico(base44) {
    const now = Date.now();
    if (configCache.expiresAt > now) return configCache.value;
    const configs = await base44.asServiceRole.entities.ConfiguracaoSistema.filter({ chave: 'global' });
    configCache.value = !!configs[0]?.modo_economico;
    configCache.expiresAt = now + 60000;
    return configCache.value;
}

function getCached(key) {
    const item = cache.get(key);
    if (!item || item.expiresAt <= Date.now()) return null;
    return item.data;
}

function setCached(key, data, modoEconomico) {
    const temDebito = data?.deve_bloquear || data?.tem_pendencia || (data?.total_debitos || 0) > 0;
    const ttl = temDebito ? 15 * 60 * 1000 : 30 * 60 * 1000;
    cache.set(key, { data: { ...data, origem_cache: true }, expiresAt: Date.now() + (modoEconomico ? ttl * 2 : ttl) });
}

// Consulta consolidada de bloqueio financeiro do cliente DIRETO no Omie.
// Retorna: títulos atrasados, em aberto, total débitos, limite de crédito, saldo disponível e se deve bloquear.
// Substitui o antigo consultarBloqueioFinanceiro que dependia de webhook externo.

async function omieCall(base44, url, call, param, opts = {}) {
    const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
    const chave = `${url}|${call}|${JSON.stringify(param || {})}`;

    const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
    const controle = cb?.[0];
    if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
        throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
    }

    if (cacheMinutes > 0) {
        const caches = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
        const cacheItem = caches?.[0];
        if (cacheItem && new Date(cacheItem.expira_em) > new Date()) return cacheItem.valor;
    }

    let lastError = '';
    for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
        });
        const data = await res.json();
        if (data.faultstring || data.faultcode) {
            const msg = String(data.faultstring || '').toLowerCase();
            if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
                const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
                if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
                else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
                throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
            }
            if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon')) {
                lastError = data.faultstring;
                await new Promise(r => setTimeout(r, 2500 * tentativa));
                continue;
            }
            throw new Error(data.faultstring || 'Erro Omie');
        }

        if (cacheMinutes > 0) {
            const payloadCache = { chave, valor: data, tipo: call, expira_em: new Date(Date.now() + cacheMinutes * 60000).toISOString(), criado_em: new Date().toISOString() };
            const existente = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
            if (existente?.[0]?.id) await base44.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payloadCache).catch(() => {});
            else await base44.asServiceRole.entities.CacheOmieConsulta.create(payloadCache).catch(() => {});
        }
        if (logIntegration) {
            await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'sucesso', payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
        }
        return data;
    }
    throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const { cliente_id, cpf_cnpj, invalidar_cache, somente_invalidar_cache, forcar_atualizacao = false } = await req.json();
        if (!cliente_id && !cpf_cnpj) {
            return Response.json({ error: 'Informe cliente_id ou cpf_cnpj' }, { status: 400 });
        }

        let cliente = null;
        let cnpjLimpo = (cpf_cnpj || '').replace(/\D/g, '');
        if (cliente_id) {
            cliente = await base44.asServiceRole.entities.Cliente.get(cliente_id);
            if (cliente && !cnpjLimpo) cnpjLimpo = (cliente.cnpj_cpf || cliente.cpf_cnpj || '').replace(/\D/g, '');
        }
        if (!cnpjLimpo) return Response.json({ error: 'CPF/CNPJ inválido' }, { status: 400 });

        if (cliente?.bloquear_faturamento === true && !forcar_atualizacao && !invalidar_cache) {
            return Response.json({
                sucesso: true,
                cliente_nome: cliente?.razao_social || cliente?.nome_fantasia || null,
                cliente_codigo: cliente?.codigo || null,
                cpf_cnpj: cnpjLimpo,
                titulos: [],
                total_titulos: 0,
                total_debitos: 0,
                titulos_atrasados: 0,
                tem_pendencia: true,
                limite_credito: 0,
                saldo_disponivel: 0,
                deve_bloquear: true,
                bloqueado_localmente: true,
                motivo: cliente.motivo_bloqueio || 'Cliente bloqueado no cadastro',
                cache_hit: false
            });
        }

        const modoEconomico = await getModoEconomico(base44);
        const cacheKey = `consultarBloqueioFinanceiroOmie:${cliente?.codigo_omie || cliente?.codigo || cliente_id || cnpjLimpo}`;
        if (invalidar_cache) cache.delete(cacheKey);
        if (somente_invalidar_cache) return Response.json({ sucesso: true, cache_invalidado: true });
        const cached = !invalidar_cache ? getCached(cacheKey) : null;
        if (cached) return Response.json({ ...cached, cache_hit: true });

        // 1. Buscar títulos ATRASADOS e EM ABERTO
        const titulosMap = new Map();
        for (const status of ['ATRASADO', 'EMABERTO']) {
            let p = 1, tp = 1;
            while (p <= tp) {
                const data = await omieCall(
                    base44,
                    "https://app.omie.com.br/api/v1/financas/pesquisartitulos/",
                    "PesquisarLancamentos",
                    { nPagina: p, nRegPorPagina: 100, cNatureza: "R", cStatus: status, cCPFCNPJCliente: cnpjLimpo },
                    { cacheMinutes: 5 }
                );
                if (data.faultstring) break;
                tp = data.nTotPaginas || 1;
                for (const t of (data.titulosEncontrados || [])) {
                    const cab = t.cabecTitulo || t;
                    const key = `${cab.cNumTitulo || ''}|${cab.cNumParcela || ''}|${cab.dDtVenc || ''}|${cab.nValorTitulo || 0}`;
                    if (!titulosMap.has(key)) {
                        titulosMap.set(key, {
                            numero: cab.cNumTitulo || '',
                            parcela: cab.cNumParcela || '',
                            valor: cab.nValorTitulo || 0,
                            vencimento: cab.dDtVenc || '',
                            status: cab.cStatus || status,
                            tipo: cab.cTipo || '',
                            documento_fiscal: cab.cNumDocFiscal || '',
                            observacao: cab.observacao || ''
                        });
                    }
                }
                p++;
            }
        }
        const titulos = Array.from(titulosMap.values());

        // 2. Consultar cliente no Omie para pegar limite de crédito
        let limiteCredito = 0;
        let clienteOmie = await omieCall(
            base44,
            "https://app.omie.com.br/api/v1/geral/clientes/",
            "ListarClientes",
            { pagina: 1, registros_por_pagina: 1, clientesFiltro: { cnpj_cpf: cnpjLimpo } },
            { cacheMinutes: 5 }
        );
        if (!clienteOmie.faultstring && clienteOmie.clientes_cadastro?.[0]) {
            limiteCredito = Number(clienteOmie.clientes_cadastro[0].valor_limite_credito || 0);
        } else if (cliente?.codigo_omie || cliente?.codigo_cliente_omie || cliente?.codigo) {
            clienteOmie = await omieCall(
                base44,
                "https://app.omie.com.br/api/v1/geral/clientes/",
                "ConsultarCliente",
                { codigo_cliente_integracao: cliente.codigo || cliente.id },
                { cacheMinutes: 5 }
            );
            if (!clienteOmie.faultstring) limiteCredito = Number(clienteOmie.valor_limite_credito || 0);
        }

        const totalDebitos = titulos.reduce((s, t) => s + (Number(t.valor) || 0), 0);
        const titulosAtrasados = titulos.filter(t => t.status === 'ATRASADO').length;
        const saldoDisponivel = limiteCredito - totalDebitos;
        const temPendencia = titulosAtrasados > 0;
        const deveBloquear = temPendencia || (limiteCredito > 0 && saldoDisponivel < 0);

        if (cliente?.id) {
            await base44.asServiceRole.entities.Cliente.update(cliente.id, {
                pendencia_financeira: deveBloquear,
                pendencia_financeira_atualizada_em: new Date().toISOString()
            });
        }

        const resultado = {
            sucesso: true,
            cliente_nome: cliente?.razao_social || cliente?.nome_fantasia || null,
            cliente_codigo: cliente?.codigo || null,
            cpf_cnpj: cnpjLimpo,
            titulos,
            total_titulos: titulos.length,
            total_debitos: totalDebitos,
            titulos_atrasados: titulosAtrasados,
            tem_pendencia: temPendencia,
            limite_credito: limiteCredito,
            saldo_disponivel: saldoDisponivel,
            deve_bloquear: deveBloquear,
            cache_hit: false
        };
        setCached(cacheKey, resultado, modoEconomico);
        return Response.json(resultado);
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});