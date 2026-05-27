import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";
let base44Global = null;

async function omieCall(call, param, opts = {}) {
    const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
    const url = OMIE_URL;
    const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
    const cb = await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
    const controle = cb?.[0];
    if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) return { faultstring: `API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`, faultcode: 'CIRCUIT_OPEN' };
    if (cacheMinutes > 0) {
        const caches = await base44Global.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
        if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
    }
    let lastError = '';
    for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] }) });
        const data = await response.json();
        if (data.faultstring || data.faultcode) {
            const fault = String(data.faultstring || '').toLowerCase();
            if (response.status === 425 || fault.includes('bloqueada') || fault.includes('bloqueio') || fault.includes('try again') || fault.includes('tente novamente')) {
                const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
                if (controle?.id) await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
                return data;
            }
            if (response.status === 429 || fault.includes('too many requests') || fault.includes('já existe uma requisição') || fault.includes('limite') || fault.includes('cota') || fault.includes('aguarde') || fault.includes('timeout')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
        }
        if (cacheMinutes > 0) {
            const payloadCache = { chave, valor: data, tipo: call, expira_em: new Date(Date.now() + cacheMinutes * 60000).toISOString(), criado_em: new Date().toISOString() };
            const existente = await base44Global.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
            if (existente?.[0]?.id) await base44Global.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payloadCache).catch(() => {}); else await base44Global.asServiceRole.entities.CacheOmieConsulta.create(payloadCache).catch(() => {});
        }
        if (logIntegration) await base44Global.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: data?.faultstring ? 'erro' : 'sucesso', mensagem_erro: data?.faultstring || null, payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
        return data;
    }
    return { faultstring: lastError || 'Rate limit persistente após todas as tentativas' };
}

const estadoParaUF = {
    'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
    'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES',
    'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
    'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
    'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
    'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
};

function normalizarEstado(estado) {
    const s = (estado || '').trim();
    if (s.length <= 2) return s.toUpperCase() || 'PE';
    const chave = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return estadoParaUF[chave] || s.substring(0, 2).toUpperCase() || 'PE';
}

function mapearClienteParaOmie(c) {
    const cnpj = (c.cpf_cnpj || '').replace(/[.\-\/\s]/g, '');
    const isPF = cnpj.length <= 11;
    return {
        codigo_cliente_integracao: c.id,
        razao_social: (c.razao_social || c.nome_fantasia || 'Cliente').substring(0, 60),
        nome_fantasia: (c.nome_fantasia || c.razao_social || '').substring(0, 100),
        cnpj_cpf: cnpj,
        pessoa_fisica: isPF ? 'S' : 'N',
        endereco: (c.endereco || '').substring(0, 60),
        endereco_numero: (c.numero || 'S/N').substring(0, 10),
        bairro: (c.bairro || '').substring(0, 60),
        cidade: (c.cidade || '').substring(0, 60),
        estado: normalizarEstado(c.estado),
        cep: (c.cep || '').replace(/\D/g, '').substring(0, 8) || '50000000',
        email: (c.email || 'nfe@paoemel.com.br').substring(0, 500),
        contribuinte: isPF ? 'N' : 'S',
        inscricao_estadual: c.inscricao_estadual || '',
        inativo: (c.status || 'ativo').toLowerCase() === 'inativo' ? 'S' : 'N',
        tags: c.codigo ? [{ tag: `COD:${c.codigo}` }] : [],
    };
}

async function upsertClienteOmie(clienteOmie) {
    return await omieCall('UpsertCliente', clienteOmie, { cacheMinutes: 15 });
}

async function excluirClienteOmie(codigoIntegracao, codigoOmie) {
    // Tenta por codigo_cliente_integracao primeiro, depois por codigo_cliente_omie
    const param = {};
    if (codigoIntegracao) param.codigo_cliente_integracao = codigoIntegracao;
    else if (codigoOmie) param.codigo_cliente_omie = codigoOmie;
    else return { faultstring: 'Sem código para excluir' };

    return await omieCall('ExcluirCliente', param, { cacheMinutes: 15 });
}

async function chamarComRetry(fn) {
    try {
        return await fn();
    } catch (e) {
        return { faultstring: e.message };
    }
}

// acao: 'upsert' | 'excluir'
// Para 'upsert': recebe { ids: string[] } — IDs de clientes Base44
// Para 'excluir': recebe { clientes: [{codigo_integracao, codigo_omie, razao_social}] }
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        base44Global = base44;
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { acao } = body;

        // === UPSERT (criar ou atualizar no Omie) ===
        if (acao === 'upsert') {
            const { ids } = body;
            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return Response.json({ error: 'ids array obrigatório' }, { status: 400 });
            }

            const clientes = [];
            for (const id of ids) {
                try {
                    const c = await base44.asServiceRole.entities.Cliente.get(id);
                    if (c) clientes.push(c);
                } catch (e) { /* skip */ }
            }

            let ok = 0, erros = 0;
            const errosList = [];

            for (let i = 0; i < clientes.length; i++) {
                const c = clientes[i];
                const clienteOmie = mapearClienteParaOmie(c);
                const resultado = await chamarComRetry(() => upsertClienteOmie(clienteOmie));

                if (resultado.faultstring) {
                    erros++;
                    errosList.push(`${c.codigo || c.id} - ${c.razao_social}: ${resultado.faultstring}`);
                } else {
                    ok++;
                }

            }

            return Response.json({ sucesso: true, enviados: ok, erros, total: clientes.length, erros_detalhes: errosList });
        }

        // === EXCLUIR do Omie (clientes que só existem no Omie) ===
        if (acao === 'excluir') {
            const { clientes } = body;
            if (!clientes || !Array.isArray(clientes) || clientes.length === 0) {
                return Response.json({ error: 'clientes array obrigatório' }, { status: 400 });
            }

            let ok = 0, erros = 0;
            const errosList = [];

            for (let i = 0; i < clientes.length; i++) {
                const c = clientes[i];
                const resultado = await chamarComRetry(() => excluirClienteOmie(c.codigo_integracao, c.codigo_omie));

                if (resultado.faultstring) {
                    const fault = resultado.faultstring.toLowerCase();
                    if (fault.includes('não encontrado') || fault.includes('não cadastrado')) {
                        ok++; // Já não existe
                    } else {
                        erros++;
                        errosList.push(`${c.razao_social || c.codigo_omie}: ${resultado.faultstring}`);
                    }
                } else {
                    ok++;
                }

            }

            return Response.json({ sucesso: true, excluidos: ok, erros, total: clientes.length, erros_detalhes: errosList });
        }

        return Response.json({ error: 'acao inválida (upsert, excluir)' }, { status: 400 });

    } catch (error) {
        console.error('[sincronizacaoCompletaOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});