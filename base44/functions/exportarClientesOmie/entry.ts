import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

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
    let normalizado = (estado || '').trim();
    if (normalizado.length > 2) {
        const chave = normalizado.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        normalizado = estadoParaUF[chave] || normalizado.substring(0, 2).toUpperCase();
    } else {
        normalizado = normalizado.toUpperCase();
    }
    return normalizado;
}

function removerAspas(val) {
    if (typeof val !== 'string') return val;
    let v = val.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

function mapearClienteParaOmie(cliente, rotaNome) {
    for (const key of Object.keys(cliente)) {
        if (typeof cliente[key] === 'string') cliente[key] = removerAspas(cliente[key]);
    }

    const cpfCnpj = (cliente.cpf_cnpj || "").replace(/[^\d]/g, "");
    const estadoNorm = normalizarEstado(cliente.estado);
    const cepNorm = (cliente.cep || "").replace(/[^\d]/g, "").substring(0, 8);
    const isPessoaFisica = cpfCnpj.length <= 11;
    const emailNorm = (cliente.email || "nfe@paoemel.com.br").substring(0, 500);
    const nomeContato = (cliente.nome_fantasia || cliente.razao_social || "").substring(0, 100);
    const codigoTag = cliente.codigo ? `COD:${cliente.codigo}` : '';
    const tags = [codigoTag].filter(Boolean).map(tag => ({ tag }));
    const rNome = rotaNome || cliente.rota_nome || '';
    const caracteristicas = rNome ? [{ campo: "Rotas", conteudo: rNome }] : [];

    const clienteOmie = {
        codigo_cliente_integracao: cliente.codigo || cliente.id,
        razao_social: (cliente.razao_social || cliente.nome_fantasia || "Cliente sem nome").substring(0, 60),
        nome_fantasia: (cliente.nome_fantasia || cliente.razao_social || "").substring(0, 100),
        cnpj_cpf: cpfCnpj,
        pessoa_fisica: isPessoaFisica ? "S" : "N",
        endereco: (cliente.endereco || "").substring(0, 60),
        endereco_numero: (cliente.numero || "S/N").substring(0, 10),
        bairro: (cliente.bairro || "").substring(0, 60),
        complemento: (cliente.complemento || "").substring(0, 60),
        cidade: (cliente.cidade || "").substring(0, 60),
        estado: estadoNorm,
        cep: cepNorm,
        contato: nomeContato,
        email: emailNorm,
        homepage: cliente.homepage || cliente.site || undefined,
        telefone1_ddd: cliente.telefone1_ddd || cliente.ddd || undefined,
        telefone1_numero: (cliente.telefone1_numero || cliente.telefone || '').replace(/[^\d]/g, '').substring(0, 20) || undefined,
        telefone2_ddd: cliente.telefone2_ddd || undefined,
        telefone2_numero: (cliente.telefone2_numero || '').replace(/[^\d]/g, '').substring(0, 20) || undefined,
        fax_ddd: cliente.fax_ddd || undefined,
        fax_numero: (cliente.fax_numero || '').replace(/[^\d]/g, '').substring(0, 20) || undefined,
        email_fatura: cliente.email_fatura || undefined,
        contribuinte: isPessoaFisica ? "N" : "S",
        inscricao_estadual: cliente.inscricao_estadual || "",
        inscricao_municipal: cliente.inscricao_municipal || undefined,
        optante_simples_nacional: cliente.optante_simples_nacional || undefined,
        produtor_rural: cliente.produtor_rural || undefined,
        exterior: cliente.exterior || undefined,
        bloqueado: cliente.bloqueado || undefined,
        observacao: cliente.observacao || undefined,
        inativo: (cliente.status || 'ativo').toLowerCase() === 'inativo' ? "S" : "N",
        tags: tags.length ? tags : undefined,
        caracteristicas: caracteristicas.length ? caracteristicas : undefined
    };

    const camposSempreEnviar = ['codigo_cliente_integracao', 'razao_social', 'pessoa_fisica', 'contribuinte', 'inativo', 'inscricao_estadual'];
    for (const [key, value] of Object.entries(clienteOmie)) {
        if (camposSempreEnviar.includes(key)) continue;
        if (value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
            delete clienteOmie[key];
        }
    }

    return clienteOmie;
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function chamarOmie(clienteOmie, metodo) {
    const response = await fetch(OMIE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            call: metodo,
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [clienteOmie]
        })
    });
    return await response.json();
}

async function fetchComRetry(cliente, modo, tentativa = 0) {
    const clienteOmie = mapearClienteParaOmie({ ...cliente });
    const metodo = modo === "incluir" ? "IncluirCliente" : "UpsertCliente";

    let resultado = await chamarOmie(clienteOmie, metodo);

    // Retry em caso de rate limit / bloqueio do Omie (máx 2 tentativas, espera curta)
    const fault = (resultado.faultstring || '').toLowerCase();
    const isBloqueio = fault.includes('too many') || fault.includes('já existe uma requisição') || fault.includes('try again') || fault.includes('consumo indevido') || fault.includes('bloqueada');
    if (fault && isBloqueio && tentativa < 2) {
        const waitSec = 5 * (tentativa + 1); // 5s, 10s
        console.log(`[exportarClientesOmie] Bloqueio, retry ${tentativa + 1}/2 em ${waitSec}s`);
        await delay(waitSec * 1000);
        return fetchComRetry(cliente, modo, tentativa + 1);
    }

    // Se deu erro de "já cadastrado" com código de integração diferente
    if (fault && fault.includes('já cadastrado') && metodo === 'UpsertCliente') {
        // Estratégia 1: Extrair o codigo_integracao antigo da mensagem de erro
        const matchCodigo = (resultado.faultstring || '').match(/código de integração \[([^\]]+)\]/i);
        const codigoAntigoOmie = matchCodigo ? matchCodigo[1] : null;
        
        if (codigoAntigoOmie && codigoAntigoOmie !== clienteOmie.codigo_cliente_integracao) {
            console.log(`[exportarClientesOmie] Fallback: usando codigo_integracao antigo "${codigoAntigoOmie}" para ${cliente.razao_social}`);
            const clienteOmieFallback = { ...clienteOmie, codigo_cliente_integracao: codigoAntigoOmie };
            await delay(600);
            resultado = await chamarOmie(clienteOmieFallback, metodo);
        }
        
        // Estratégia 2: Se ainda falhou, buscar pelo CPF/CNPJ no Omie
        if (resultado.faultstring && clienteOmie.cnpj_cpf) {
            await delay(600);
            try {
                const resCpf = await fetch(OMIE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: "ListarClientes",
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{ pagina: 1, registros_por_pagina: 5, clientesFiltro: { cnpj_cpf: clienteOmie.cnpj_cpf } }]
                    })
                });
                const dataCpf = await resCpf.json();
                if (!dataCpf.faultstring && dataCpf.clientes_cadastro && dataCpf.clientes_cadastro.length > 0) {
                    const codAntigoReal = dataCpf.clientes_cadastro[0].codigo_cliente_integracao;
                    console.log(`[exportarClientesOmie] Encontrado pelo CPF/CNPJ com codigo_integracao: ${codAntigoReal}`);
                    const clienteOmieFallback2 = { ...clienteOmie, codigo_cliente_integracao: codAntigoReal };
                    await delay(600);
                    resultado = await chamarOmie(clienteOmieFallback2, metodo);
                }
            } catch (cpfErr) {
                console.log(`[exportarClientesOmie] Erro busca CPF/CNPJ: ${cpfErr.message}`);
            }
        }
    }

    return {
        cliente_id: cliente.id,
        razao_social: cliente.razao_social,
        nome_fantasia: cliente.nome_fantasia,
        sucesso: !resultado.faultstring,
        codigo_omie: resultado.codigo_cliente_omie || null,
        mensagem: resultado.faultstring || resultado.descricao_status || "Exportado com sucesso"
    };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { clientes_data, modo = "upsert" } = body;

        // clientes_data = array de objetos cliente já completos (enviados pelo frontend)
        if (!clientes_data || !Array.isArray(clientes_data) || clientes_data.length === 0) {
            return Response.json({ error: 'Informe os dados dos clientes para exportar' }, { status: 400 });
        }

        console.log(`[exportarClientesOmie] Recebido ${clientes_data.length} clientes para exportar via ${modo}`);

        // Buscar rotas para enriquecer com rota_nome
        const rotas = await base44.asServiceRole.entities.Rota.list();
        const rotasMap = {};
        rotas.forEach(r => { rotasMap[r.id] = r.nome; });

        // Enriquecer clientes com rota_nome
        clientes_data.forEach(c => {
            if (c.rota_id && rotasMap[c.rota_id] && !c.rota_nome) {
                c.rota_nome = rotasMap[c.rota_id];
            }
        });

        // Envio em PARALELO com concorrência limitada (doc Omie: 4 simultâneas, 240 req/min)
        // 4 simultâneas no limite. fetchComRetry já tem backoff em 425/520.
        const PARALELISMO = 4;
        const resultados = new Array(clientes_data.length);
        let cursor = 0;

        const worker = async () => {
            while (true) {
                const i = cursor++;
                if (i >= clientes_data.length) break;
                const cliente = clientes_data[i];
                try {
                    const res = await fetchComRetry(cliente, modo);
                    resultados[i] = res;
                    console.log(`[exportarClientesOmie] ${i + 1}/${clientes_data.length} ${res.sucesso ? 'OK' : 'ERRO'}: ${cliente.razao_social}`);
                } catch (err) {
                    resultados[i] = {
                        cliente_id: cliente.id,
                        razao_social: cliente.razao_social,
                        nome_fantasia: cliente.nome_fantasia,
                        sucesso: false,
                        codigo_omie: null,
                        mensagem: err.message
                    };
                }
            }
        };

        await Promise.all(Array.from({ length: PARALELISMO }, () => worker()));

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.filter(r => !r.sucesso).length;

        return Response.json({
            resumo: {
                total: resultados.length,
                sucessos,
                erros
            },
            resultados
        });

    } catch (error) {
        console.error('[exportarClientesOmie] Erro geral:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});