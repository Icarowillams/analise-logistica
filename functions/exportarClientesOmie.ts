import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

// Mapa de nome completo do estado para sigla UF
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

function mapearClienteParaOmie(cliente) {
    // Limpar aspas de campos texto
    for (const key of Object.keys(cliente)) {
        if (typeof cliente[key] === 'string') cliente[key] = removerAspas(cliente[key]);
    }

    const cpfCnpj = (cliente.cpf_cnpj || "").replace(/[^\d]/g, "");
    const estadoNorm = normalizarEstado(cliente.estado);
    const cepNorm = (cliente.cep || "").replace(/[^\d]/g, "").substring(0, 8);
    const isPessoaFisica = cpfCnpj.length <= 11;

    const clienteOmie = {
        codigo_cliente_integracao: cliente.id,
        razao_social: (cliente.razao_social || cliente.nome_fantasia || "Cliente sem nome").substring(0, 60),
        nome_fantasia: (cliente.nome_fantasia || cliente.razao_social || "").substring(0, 100),
        cnpj_cpf: cpfCnpj,
        pessoa_fisica: isPessoaFisica ? "S" : "N",
        endereco: (cliente.endereco || "").substring(0, 60),
        endereco_numero: (cliente.numero || "S/N").substring(0, 10),
        bairro: (cliente.bairro || "").substring(0, 60),
        complemento: "",
        cidade: (cliente.cidade || "").substring(0, 60),
        estado: estadoNorm,
        cep: cepNorm,
        contato: "",
        email: (cliente.email || "nfe@paoemel.com.br").substring(0, 500),
        contribuinte: isPessoaFisica ? "N" : "S",
        inscricao_estadual: cliente.inscricao_estadual || "",
        observacao: "",
        inativo: (cliente.status || 'ativo').toLowerCase() === 'inativo' ? "S" : "N",
        tags: cliente.codigo ? [{ tag: `COD:${cliente.codigo}` }] : []
    };

    // Remover campos vazios
    const camposObrigatorios = ['codigo_cliente_integracao', 'razao_social', 'pessoa_fisica', 'contribuinte', 'inativo'];
    for (const [key, value] of Object.entries(clienteOmie)) {
        if (camposObrigatorios.includes(key)) continue;
        if (value === '' || value === null || value === undefined) {
            delete clienteOmie[key];
        }
    }

    return clienteOmie;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { cliente_ids, modo = "upsert", lote_inicio = 0 } = body;

        if (!cliente_ids || !Array.isArray(cliente_ids) || cliente_ids.length === 0) {
            return Response.json({ error: 'Informe os IDs dos clientes para exportar' }, { status: 400 });
        }

        const LOTE_MAX = 100;
        const clientesDoLote = cliente_ids.slice(lote_inicio, lote_inicio + LOTE_MAX);
        
        if (clientesDoLote.length === 0) {
            return Response.json({ 
                concluido: true,
                resumo: { total: 0, sucessos: 0, erros: 0 },
                resultados: []
            });
        }

        const clientes = await base44.entities.Cliente.list();
        const clientesParaExportar = clientes.filter(c => clientesDoLote.includes(c.id));

        const resultados = [];
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (const cliente of clientesParaExportar) {
            const clienteOmie = mapearClienteParaOmie(cliente);
            const metodo = modo === "incluir" ? "IncluirCliente" : "UpsertCliente";

            try {
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

                const resultado = await response.json();

                resultados.push({
                    cliente_id: cliente.id,
                    razao_social: cliente.razao_social,
                    sucesso: !resultado.faultstring,
                    codigo_omie: resultado.codigo_cliente_omie || null,
                    mensagem: resultado.faultstring || resultado.descricao_status || "Exportado com sucesso"
                });
            } catch (err) {
                resultados.push({
                    cliente_id: cliente.id,
                    razao_social: cliente.razao_social,
                    sucesso: false,
                    codigo_omie: null,
                    mensagem: err.message
                });
            }

            await delay(1000);
        }

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.filter(r => !r.sucesso).length;
        const proximoLote = lote_inicio + LOTE_MAX;
        const concluido = proximoLote >= cliente_ids.length;

        return Response.json({
            concluido,
            proximo_lote: concluido ? null : proximoLote,
            total_geral: cliente_ids.length,
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