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
// (preserva o tratamento "já não existia" desta função). Registra circuit breaker em bloqueio/425.
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
        const body = await req.json();

        const { event, data: produto } = body;

        console.log('[excluirProdutoOmie] Event:', JSON.stringify(event));

        const produtoId = event?.entity_id || produto?.id;
        const produtoNome = produto?.nome || 'N/A';
        const produtoCodigo = produto?.codigo || 'N/A';

        if (!produtoId) {
            console.log('[excluirProdutoOmie] Nenhum ID de produto encontrado');
            return Response.json({ error: 'Produto não informado' }, { status: 400 });
        }

        console.log('[excluirProdutoOmie] Excluindo produto do Omie - ID:', produtoId, '- Nome:', produtoNome, '- Código:', produtoCodigo);

        const resultado = await omieCall(base44, "geral/produtos/", { codigo_produto_integracao: produtoId }, { call: "ExcluirProduto", skipLog: true });

        console.log('[excluirProdutoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            const erroLower = resultado.faultstring.toLowerCase();
            if (erroLower.includes('não encontrado') || erroLower.includes('não cadastrado') || erroLower.includes('not found')) {
                console.log('[excluirProdutoOmie] Produto já não existe no Omie (ignorando):', resultado.faultstring);
                return Response.json({
                    sucesso: true,
                    mensagem: 'Produto já não existia no Omie'
                });
            }

            console.error('[excluirProdutoOmie] Erro Omie:', resultado.faultstring);
            return Response.json({
                sucesso: false,
                erro: resultado.faultstring
            });
        }

        console.log('[excluirProdutoOmie] Produto excluído do Omie:', produtoNome);
        return Response.json({
            sucesso: true,
            mensagem: 'Produto excluído do Omie com sucesso'
        });

    } catch (error) {
        console.error('[excluirProdutoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});