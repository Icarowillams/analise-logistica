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

// omieCall canônico (canal único ao Omie). Auto-contido. Em faultstring devolve o objeto bruto
// (preserva o tratamento de erro por item desta função). Registra circuit breaker em bloqueio/425.
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
            const isBlocked = msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('consumo indevido');
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

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { vendedor_ids, modo = "upsert", lote_inicio = 0 } = body;

        if (!vendedor_ids || !Array.isArray(vendedor_ids) || vendedor_ids.length === 0) {
            return Response.json({ error: 'Informe os IDs dos vendedores para exportar' }, { status: 400 });
        }

        // Processar no máximo 10 vendedores por chamada (Omie tem limite rigoroso de ~50 req/min)
        const LOTE_MAX = 10;
        const vendedoresDoLote = vendedor_ids.slice(lote_inicio, lote_inicio + LOTE_MAX);
        
        if (vendedoresDoLote.length === 0) {
            return Response.json({ 
                concluido: true,
                resumo: { total: 0, sucessos: 0, erros: 0 },
                resultados: []
            });
        }

        // Buscar vendedores
        const vendedores = await base44.entities.Vendedor.list();
        const vendedoresParaExportar = vendedores.filter(v => vendedoresDoLote.includes(v.id));

        const resultados = [];
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (const vendedor of vendedoresParaExportar) {
            // Campos conforme documentação Omie API Vendedores:
            // - codInt: código de integração (nosso ID interno) - string30
            // - nome: nome do vendedor - string70
            // - email: email do vendedor - string100
            // - inativo: S/N - string1
            // - fatura_pedido: S/N - string1
            // - visualiza_pedido: S/N - string1
            // - comissao: percentual de comissão - decimal
            
            const vendedorOmie = {
                codInt: vendedor.id.substring(0, 30),
                nome: (vendedor.nome || "Vendedor sem nome").substring(0, 70),
                email: (vendedor.email || "").substring(0, 100),
                inativo: vendedor.status === 'inativo' ? "S" : "N",
                fatura_pedido: "S",
                visualiza_pedido: "N",
                comissao: 0.5
            };

            const metodo = modo === "incluir" ? "IncluirVendedor" : "UpsertVendedor";

            try {
                const resultado = await omieCall(base44, "geral/vendedores/", vendedorOmie, { call: metodo, skipLog: true });

                resultados.push({
                    vendedor_id: vendedor.id,
                    nome: vendedor.nome,
                    email: vendedor.email,
                    sucesso: !resultado.faultstring,
                    codigo_omie: resultado.codigo || null,
                    mensagem: resultado.faultstring || resultado.descricao || "Exportado com sucesso"
                });
            } catch (err) {
                resultados.push({
                    vendedor_id: vendedor.id,
                    nome: vendedor.nome,
                    email: vendedor.email,
                    sucesso: false,
                    codigo_omie: null,
                    mensagem: err.message
                });
            }

            // Aguardar 3000ms entre requisições para evitar rate limit da Omie
            await delay(3000);
        }

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.filter(r => !r.sucesso).length;
        const proximoLote = lote_inicio + LOTE_MAX;
        const concluido = proximoLote >= vendedor_ids.length;

        return Response.json({
            concluido,
            proximo_lote: concluido ? null : proximoLote,
            total_geral: vendedor_ids.length,
            resumo: {
                total: resultados.length,
                sucessos,
                erros
            },
            resultados
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});