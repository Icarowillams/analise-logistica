import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

// Rate limit: 1500ms entre chamadas Omie (evita bloqueio por consumo indevido)
const OMIE_DELAY_MS = 1500;
const delay = (ms) => new Promise(r => setTimeout(r, ms));

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
// (preserva o fallback Alterar→Incluir desta função). Registra circuit breaker em bloqueio/425.
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
            if (i < RETRIES.length) { await delay(RETRIES[i]); continue; }
            return { faultstring: e.name === 'AbortError' ? 'Timeout na chamada Omie' : e.message };
        }
        clearTimeout(tid);
        if (res.status >= 500 || res.status === 429) {
            const corpo = await res.text().catch(() => '');
            if (i < RETRIES.length) { await delay(RETRIES[i]); continue; }
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
            if (isRate && i < RETRIES.length) { await delay(RETRIES[i]); continue; }
            return data;
        }
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
        return data;
    }
    return { faultstring: 'Máximo de tentativas Omie excedido' };
}

// Envia uma característica genérica (Rotas, Vendedor, etc.) — upsert via AlterarCaractCliente
// com fallback para IncluirCaractCliente se a característica ainda não existe no cliente.
async function enviarCaracteristica(base44, clienteCodigo, campo, conteudo) {
    const payload = {
        codigo_cliente_integracao: clienteCodigo,
        campo,
        conteudo
    };

    const result = await omieCall(base44, "geral/clientescaract/", payload, { call: "AlterarCaractCliente", skipLog: true });

    if (result.faultstring) {
        const faultLower = String(result.faultstring).toLowerCase();
        const isNotFound = faultLower.includes('não encontr') || faultLower.includes('nao encontr');

        if (isNotFound) {
            await delay(OMIE_DELAY_MS);
            const inclResult = await omieCall(base44, "geral/clientescaract/", payload, { call: "IncluirCaractCliente", skipLog: true });
            if (inclResult.faultstring) return { erro: inclResult.faultstring };
            return { sucesso: true, metodo: 'incluir' };
        }
        return { erro: result.faultstring };
    }
    return { sucesso: true, metodo: 'alterar' };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Acesso negado' }, { status: 403 });
        }

        const body = await req.json();
        const { action, cliente_ids } = body;

        // === CONSOLIDAR ===
        if (action === 'consolidar') {
            const [clientes, rotas, vendedores] = await Promise.all([
                base44.asServiceRole.entities.Cliente.list('-created_date', 5000),
                base44.asServiceRole.entities.Rota.list(),
                base44.asServiceRole.entities.Vendedor.list()
            ]);
            const rotasMap = {};
            rotas.forEach(r => { rotasMap[r.id] = r; });
            const vendMap = {};
            vendedores.forEach(v => { vendMap[v.id] = v; });

            const consolidado = clientes
                .filter(c => (c.rota_id && rotasMap[c.rota_id]) || (c.vendedor_id && vendMap[c.vendedor_id]))
                .map(c => ({
                    cliente_id: c.id,
                    cliente_codigo: c.codigo || c.id,
                    codigo: c.codigo,
                    razao_social: c.razao_social,
                    nome_fantasia: c.nome_fantasia,
                    cpf_cnpj: c.cpf_cnpj,
                    rota_id: c.rota_id,
                    rota_nome: rotasMap[c.rota_id]?.nome || '',
                    vendedor_id: c.vendedor_id,
                    vendedor_nome: vendMap[c.vendedor_id]?.nome || '',
                    status: c.status,
                }));

            return Response.json({
                sucesso: true,
                total_clientes: clientes.length,
                total_com_rota: consolidado.filter(c => c.rota_nome).length,
                total_com_vendedor: consolidado.filter(c => c.vendedor_nome).length,
                total_sem_caract: clientes.length - consolidado.length,
                clientes: consolidado,
            });
        }

        // === ENVIAR LOTE ===
        // Recebe um array de { cliente_id, cliente_codigo, rota_nome, vendedor_nome } — envia ambas as características
        if (action === 'enviar_lote') {
            if (!cliente_ids || !Array.isArray(cliente_ids) || cliente_ids.length === 0) {
                return Response.json({ error: 'cliente_ids obrigatório (array de {cliente_id, rota_nome, vendedor_nome})' }, { status: 400 });
            }

            const lote = cliente_ids.slice(0, 30);
            const resultados = [];
            let sucesso = 0;
            let erros = 0;

            for (const item of lote) {
                const codigo = item.cliente_codigo || item.cliente_id;
                const erros_item = [];

                if (item.rota_nome) {
                    const r = await enviarCaracteristica(base44, codigo, "Rotas", item.rota_nome);
                    if (!r.sucesso) erros_item.push(`Rotas: ${r.erro}`);
                    await delay(OMIE_DELAY_MS);
                }
                if (item.vendedor_nome) {
                    const v = await enviarCaracteristica(base44, codigo, "Vendedor", item.vendedor_nome);
                    if (!v.sucesso) erros_item.push(`Vendedor: ${v.erro}`);
                    await delay(OMIE_DELAY_MS);
                }

                if (erros_item.length === 0) {
                    sucesso++;
                    resultados.push({ cliente_id: item.cliente_id, sucesso: true });
                } else {
                    erros++;
                    resultados.push({ cliente_id: item.cliente_id, erro: erros_item.join(' | ') });
                }
            }

            return Response.json({
                sucesso: true,
                total_enviados: sucesso,
                total_erros: erros,
                resultados,
            });
        }

        return Response.json({ error: 'Action inválida. Use "consolidar" ou "enviar_lote".' }, { status: 400 });

    } catch (error) {
        console.error('[enviarRotasCaractOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});