// ============================================================================
// exportarClientesOmie — INSERT DIRETO no Omie (IncluirCliente)
// ============================================================================
// Filosofia:
//  - Recebe array de clientes do Base44 (já completos, vindos do frontend)
//  - Mapeia TODOS os campos relevantes para clientes_cadastro do Omie
//  - Chama IncluirCliente direto (sem upsert, sem fallback, sem consulta prévia)
//  - Paralelismo 4 (limite oficial Omie: 4 simultâneas / 240 req/min)
//  - Backoff só em rate-limit (425/520/429). Erro de negócio falha imediato.
//  - Validação local antes da chamada → economiza tempo e crédito da API.
//
// Doc Omie: https://app.omie.com.br/api/v1/geral/clientes/
// ============================================================================

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const PARALELISMO = 4; // Limite oficial Omie

// ============================================================================
// HELPERS
// ============================================================================

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Estado por extenso → UF
const ESTADO_UF = {
    'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
    'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES',
    'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
    'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
    'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
    'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
};

function normalizarUF(estado) {
    let v = (estado || '').trim();
    if (v.length > 2) {
        const k = v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return ESTADO_UF[k] || v.substring(0, 2).toUpperCase();
    }
    return v.toUpperCase();
}

function limparDoc(doc) {
    return (doc || '').replace(/\D/g, '');
}

function limparCEP(cep) {
    return (cep || '').replace(/\D/g, '').substring(0, 8);
}

function limparTel(tel) {
    return (tel || '').replace(/\D/g, '').substring(0, 20);
}

// Remove aspas extras de campos texto
function rmAspas(v) {
    if (typeof v !== 'string') return v;
    let s = v.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

// Separa telefone em DDD + número
function separarTelefone(tel) {
    const limpo = limparTel(tel);
    if (limpo.length < 10) return { ddd: '', numero: '' };
    return { ddd: limpo.substring(0, 2), numero: limpo.substring(2) };
}

// Valida dígito verificador de CPF
function validarCPF(cpf) {
    cpf = limparDoc(cpf);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let s = 0;
    for (let i = 0; i < 9; i++) s += parseInt(cpf[i]) * (10 - i);
    let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
    if (d1 !== parseInt(cpf[9])) return false;
    s = 0;
    for (let i = 0; i < 10; i++) s += parseInt(cpf[i]) * (11 - i);
    let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
    return d2 === parseInt(cpf[10]);
}

// Valida dígito verificador de CNPJ
function validarCNPJ(cnpj) {
    cnpj = limparDoc(cnpj);
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
    const calc = (base, pesos) => {
        let s = 0;
        for (let i = 0; i < pesos.length; i++) s += parseInt(base[i]) * pesos[i];
        const r = s % 11;
        return r < 2 ? 0 : 11 - r;
    };
    const d1 = calc(cnpj, [5,4,3,2,9,8,7,6,5,4,3,2]);
    if (d1 !== parseInt(cnpj[12])) return false;
    const d2 = calc(cnpj, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
    return d2 === parseInt(cnpj[13]);
}

function validarDoc(doc) {
    const d = limparDoc(doc);
    if (d.length === 11) return validarCPF(d);
    if (d.length === 14) return validarCNPJ(d);
    return false;
}

// ============================================================================
// MAPPER — Cliente Base44 → clientes_cadastro Omie
// ============================================================================

function mapearCliente(c, contexto = {}) {
    // Limpar aspas em todos os campos string
    const cli = {};
    for (const [k, v] of Object.entries(c)) {
        cli[k] = typeof v === 'string' ? rmAspas(v) : v;
    }

    const doc = limparDoc(cli.cnpj_cpf || cli.cpf_cnpj);
    const isPF = doc.length === 11;
    const uf = normalizarUF(cli.estado);

    // === Inscrição Estadual / Contribuinte ===
    const ieRaw = String(cli.inscricao_estadual || '').trim();
    const ieDigitos = ieRaw.replace(/\D/g, '');
    const ieLixo = !ieDigitos
        || /^isent/i.test(ieRaw)
        || ieDigitos.length < 2
        || /^(\d)\1+$/.test(ieDigitos);

    let contribuinte, ieEnvio;
    if (isPF) {
        contribuinte = "N";
        ieEnvio = "";
    } else if (ieLixo) {
        contribuinte = "N";
        ieEnvio = "ISENTO";
    } else {
        contribuinte = "S";
        ieEnvio = ieDigitos;
    }

    // === Telefones ===
    const tel1 = separarTelefone(cli.telefone);
    const tel2 = separarTelefone(cli.telefone_2);

    // === Tags ===
    const tagsBase = (cli.tags || []).filter(t => t).map(t => ({ tag: String(t).substring(0, 60) }));
    if (cli.codigo) tagsBase.push({ tag: `COD:${cli.codigo}` });

    // === Características (Rota + Vendedor) ===
    const caracts = [];
    if (contexto.rotaNome) caracts.push({ campo: "Rotas", conteudo: String(contexto.rotaNome).substring(0, 60) });
    if (contexto.vendedorNome) caracts.push({ campo: "Vendedor", conteudo: String(contexto.vendedorNome).substring(0, 60) });

    // === Observação combinada (CNAE, observações livres) ===
    const obsPartes = [];
    if (cli.cnae) obsPartes.push(`CNAE: ${cli.cnae}`);
    if (cli.observacoes) obsPartes.push(cli.observacoes);

    // === Email ===
    const email = (cli.email_nfe || cli.email || '').substring(0, 500);

    // === Cadastro completo conforme doc Omie ===
    const omie = {
        // Identificação
        codigo_cliente_integracao: cli.codigo || cli.id,

        // Dados principais
        razao_social: (cli.razao_social || cli.nome_fantasia || 'Cliente').substring(0, 60),
        nome_fantasia: (cli.nome_fantasia || cli.razao_social || '').substring(0, 100),
        cnpj_cpf: doc,
        pessoa_fisica: isPF ? "S" : "N",

        // Contato
        contato: (cli.contato_nome || '').substring(0, 100),
        email: email,
        homepage: (cli.site || '').substring(0, 200),

        // Telefones
        telefone1_ddd: tel1.ddd,
        telefone1_numero: tel1.numero,
        telefone2_ddd: tel2.ddd,
        telefone2_numero: tel2.numero,

        // Endereço
        endereco: (cli.endereco || '').substring(0, 60),
        endereco_numero: (cli.numero || 'S/N').substring(0, 10),
        complemento: (cli.complemento || '').substring(0, 100),
        bairro: (cli.bairro || '').substring(0, 60),
        cidade: (cli.cidade || '').substring(0, 60),
        estado: uf,
        cep: limparCEP(cli.cep),

        // Tributação
        contribuinte: contribuinte,
        inscricao_estadual: ieEnvio,
        inscricao_municipal: (cli.inscricao_municipal || '').substring(0, 30),

        // Status
        inativo: (cli.status === 'inativo' || cli.bloquear_faturamento) ? "S" : "N",
        bloquear_faturamento: cli.bloquear_faturamento ? "S" : "N",

        // Observação
        observacao: obsPartes.join(' | ').substring(0, 500),

        // Tags & Características
        tags: tagsBase,
        caracteristicas: caracts,
    };

    // Tabela de preço
    if (contexto.tabelaOmieId) {
        omie.tabela_preco = Number(contexto.tabelaOmieId);
    }

    // Limpar campos vazios (Omie aceita ausência, mas não string vazia em alguns)
    const SEMPRE_ENVIAR = ['codigo_cliente_integracao', 'razao_social', 'cnpj_cpf', 'pessoa_fisica', 'contribuinte', 'inativo', 'inscricao_estadual'];
    for (const [k, v] of Object.entries(omie)) {
        if (SEMPRE_ENVIAR.includes(k)) continue;
        if (v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0)) {
            delete omie[k];
        }
    }

    return omie;
}

// ============================================================================
// CHAMADA OMIE — IncluirCliente com backoff só em rate-limit
// ============================================================================

async function incluirClienteOmie(payload, tentativa = 0) {
    const res = await fetch(OMIE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            call: 'IncluirCliente',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [payload]
        })
    });
    const data = await res.json();

    // Retry SOMENTE em rate-limit (425/520/429), nunca em erro de negócio
    if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        const fc = String(data.faultcode || '');
        const isRate = fc.includes('425') || fc.includes('520') || res.status === 429
            || msg.includes('too many') || msg.includes('cota') || msg.includes('limite de requisi')
            || msg.includes('aguarde') || msg.includes('try again');
        if (isRate && tentativa < 3) {
            await sleep(1500 * (tentativa + 1));
            return incluirClienteOmie(payload, tentativa + 1);
        }
    }
    return data;
}

// ============================================================================
// PROCESSADOR INDIVIDUAL
// ============================================================================

async function processarCliente(cliente, contextos) {
    // Validação local — falha instantânea sem chamar Omie
    const doc = limparDoc(cliente.cnpj_cpf || cliente.cpf_cnpj);
    if (!doc) {
        return resultado(cliente, false, null, 'CPF/CNPJ ausente');
    }
    if (!validarDoc(doc)) {
        return resultado(cliente, false, null, `CPF/CNPJ inválido (dígito verificador): ${doc}`);
    }
    if (!cliente.razao_social && !cliente.nome_fantasia) {
        return resultado(cliente, false, null, 'Razão social/Nome fantasia ausente');
    }
    if (cliente.tipo_nota === 'D1') {
        return resultado(cliente, false, null, 'Cliente D1 — não vai ao Omie');
    }

    // Contexto adicional (rota, vendedor, tabela)
    const ctx = {
        rotaNome: contextos.rotas?.[cliente.rota_id] || cliente.rota_nome || '',
        vendedorNome: contextos.vendedores?.[cliente.vendedor_id] || cliente.vendedor_nome || '',
        tabelaOmieId: contextos.tabelas?.[cliente.tabela_id] || null,
    };

    const payload = mapearCliente(cliente, ctx);
    const resp = await incluirClienteOmie(payload);

    if (resp.faultstring) {
        return resultado(cliente, false, null, resp.faultstring);
    }

    return resultado(cliente, true, resp.codigo_cliente_omie, resp.descricao_status || 'Incluído com sucesso');
}

function resultado(c, sucesso, codigo, msg) {
    return {
        cliente_id: c.id,
        razao_social: c.razao_social,
        nome_fantasia: c.nome_fantasia,
        sucesso,
        codigo_omie: codigo,
        mensagem: msg
    };
}

// ============================================================================
// HANDLER
// ============================================================================

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const { clientes_data } = await req.json();
        if (!Array.isArray(clientes_data) || clientes_data.length === 0) {
            return Response.json({ error: 'clientes_data vazio' }, { status: 400 });
        }

        const t0 = Date.now();
        console.log(`[exportarClientesOmie] Iniciando ${clientes_data.length} clientes — paralelismo ${PARALELISMO}`);

        // Pré-carregar contextos (rotas, vendedores, tabelas) — 1 query cada
        const [rotas, vendedores, tabelas] = await Promise.all([
            base44.asServiceRole.entities.Rota.list().catch(() => []),
            base44.asServiceRole.entities.Vendedor.list().catch(() => []),
            base44.asServiceRole.entities.TabelaPreco.list().catch(() => []),
        ]);

        const contextos = {
            rotas: Object.fromEntries(rotas.map(r => [r.id, r.nome])),
            vendedores: Object.fromEntries(vendedores.map(v => [v.id, v.nome])),
            tabelas: Object.fromEntries(tabelas.filter(t => t.omie_id).map(t => [t.id, t.omie_id])),
        };

        // Processar com paralelismo controlado
        const resultados = new Array(clientes_data.length);
        let cursor = 0;

        const worker = async () => {
            while (true) {
                const i = cursor++;
                if (i >= clientes_data.length) break;
                try {
                    resultados[i] = await processarCliente(clientes_data[i], contextos);
                } catch (e) {
                    resultados[i] = resultado(clientes_data[i], false, null, e.message);
                }
            }
        };

        await Promise.all(Array.from({ length: PARALELISMO }, () => worker()));

        // Atualizar codigo_omie no Base44 para os que sucederam (em paralelo, sem bloquear retorno)
        const updates = resultados
            .filter(r => r.sucesso && r.codigo_omie && r.cliente_id)
            .map(r =>
                base44.asServiceRole.entities.Cliente.update(r.cliente_id, { codigo_omie: String(r.codigo_omie) })
                    .catch(e => console.log(`[exportarClientesOmie] Falha update ${r.cliente_id}: ${e.message}`))
            );
        await Promise.all(updates);

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.length - sucessos;
        const dur = ((Date.now() - t0) / 1000).toFixed(1);

        console.log(`[exportarClientesOmie] Concluído em ${dur}s — ${sucessos} ok / ${erros} erro`);

        return Response.json({
            resumo: { total: resultados.length, sucessos, erros, duracao_s: Number(dur) },
            resultados
        });

    } catch (error) {
        console.error('[exportarClientesOmie] Erro fatal:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});