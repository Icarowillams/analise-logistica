import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

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
    const response = await fetch(OMIE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            call: 'UpsertCliente',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [clienteOmie]
        })
    });
    return await response.json();
}

async function excluirClienteOmie(codigoIntegracao, codigoOmie) {
    // Tenta por codigo_cliente_integracao primeiro, depois por codigo_cliente_omie
    const param = {};
    if (codigoIntegracao) param.codigo_cliente_integracao = codigoIntegracao;
    else if (codigoOmie) param.codigo_cliente_omie = codigoOmie;
    else return { faultstring: 'Sem código para excluir' };

    const response = await fetch(OMIE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            call: 'ExcluirCliente',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [param]
        })
    });
    return await response.json();
}

async function chamarComRetry(fn, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let resultado;
        try {
            resultado = await fn();
        } catch (e) {
            resultado = { faultstring: e.message };
        }
        const fault = (resultado.faultstring || '').toLowerCase();
        if (fault && (fault.includes('too many requests') || fault.includes('já existe uma requisição') || fault.includes('try again'))) {
            await delay(3000 * Math.pow(2, attempt));
            continue;
        }
        return resultado;
    }
    return { faultstring: 'Rate limit persistente após todas as tentativas' };
}

// acao: 'upsert' | 'excluir'
// Para 'upsert': recebe { ids: string[] } — IDs de clientes Base44
// Para 'excluir': recebe { clientes: [{codigo_integracao, codigo_omie, razao_social}] }
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
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
                if (i < clientes.length - 1) await delay(500);
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
                if (i < clientes.length - 1) await delay(500);
            }

            return Response.json({ sucesso: true, excluidos: ok, erros, total: clientes.length, erros_detalhes: errosList });
        }

        return Response.json({ error: 'acao inválida (upsert, excluir)' }, { status: 400 });

    } catch (error) {
        console.error('[sincronizacaoCompletaOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});