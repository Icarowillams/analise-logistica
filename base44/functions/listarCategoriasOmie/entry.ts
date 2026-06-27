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

// omieCall canônico (canal único ao Omie). Auto-contido. Lança Error em faultstring.
async function omieCall(base44, endpoint, param, options = {}) {
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
            const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
            clearTimeout(tid);
            if (res.status >= 500 || res.status === 429 || res.status === 425) {
                const corpo = await res.text().catch(() => '');
                lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
                if (res.status === 425) {
                    const _rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
                    const _cb = _rows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
                    const _p = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
                    if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
                    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
                    throw new Error(lastErr);
                }
                if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
                throw new Error(lastErr);
            }
            const data = await res.json();
            if (data.faultstring) {
                const msg = String(data.faultstring).toLowerCase();
                if (msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
                    const _rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
                    const _cb = _rows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
                    const _p = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() };
                    if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
                    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
                    throw new Error(data.faultstring);
                }
                if (msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
                throw new Error(data.faultstring);
            }
            await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
            return data;
        } catch (e) {
            lastErr = e.message;
            if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
            if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
            throw new Error(lastErr);
        }
    }
    throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const codigo = body.codigo ? String(body.codigo) : null;
        const registrosPorPagina = Math.min(Number(body.registros_por_pagina || 100), 500);
        let pagina = 1;
        let totalPaginas = 1;
        const categorias = [];

        do {
            const param = {
                pagina,
                registros_por_pagina: registrosPorPagina
            };

            if (codigo) {
                param.filtrar_por_codigo = codigo;
            }

            const data = await omieCall(base44, 'geral/categorias/', param, { call: 'ListarCategorias', skipLog: true });

            const lista = data.categoria_cadastro || data.categorias || [];
            categorias.push(...lista.map((categoria) => ({
                codigo: categoria.codigo || categoria.codigo_categoria,
                descricao: categoria.descricao || categoria.descricao_categoria,
                inativa: categoria.conta_inativa === 'S' || categoria.inativa === 'S',
                conta_despesa: categoria.conta_despesa,
                conta_receita: categoria.conta_receita
            })));

            totalPaginas = Number(data.total_de_paginas || data.total_paginas || 1);
            pagina += 1;
        } while (!codigo && pagina <= totalPaginas && categorias.length < 1000);

        return Response.json({ total: categorias.length, categorias });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});