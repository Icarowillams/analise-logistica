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

function mapearClienteParaOmie(cliente) {
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
        email: "",
        contribuinte: isPessoaFisica ? "N" : "S",
        inscricao_estadual: cliente.inscricao_estadual || "",
        observacao: "",
        inativo: (cliente.status || 'ativo').toLowerCase() === 'inativo' ? "S" : "N"
    };

    const camposObrigatorios = ['codigo_cliente_integracao', 'razao_social', 'pessoa_fisica', 'contribuinte', 'inativo'];
    for (const [key, value] of Object.entries(clienteOmie)) {
        if (camposObrigatorios.includes(key)) continue;
        if (value === '' || value === null || value === undefined) {
            delete clienteOmie[key];
        }
    }
    return clienteOmie;
}

// Busca todos os clientes cadastrados no Omie usando código de integração
async function buscarClientesOmie() {
    const todosClientes = [];
    let pagina = 1;
    const registrosPorPagina = 500;

    while (true) {
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ListarClientes",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    pagina,
                    registros_por_pagina: registrosPorPagina,
                    apenas_importado_api: "N",
                    filtrar_apenas_ativo: "N"
                }]
            })
        });

        const data = await response.json();

        if (data.faultstring) {
            console.error('Erro ao listar clientes Omie:', data.faultstring);
            break;
        }

        const clientes = data.clientes_cadastro || [];
        todosClientes.push(...clientes);

        const totalPaginas = data.total_de_paginas || 1;
        if (pagina >= totalPaginas) break;
        pagina++;

        await new Promise(r => setTimeout(r, 500));
    }

    return todosClientes;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { modo = "verificar", lote_inicio = 0, ids_para_enviar = null } = body;

        // MODO: verificar — compara Base44 x Omie e retorna quem está faltando
        if (modo === "verificar") {
            console.log('[sincronizarClientesOmie] Buscando clientes no Base44...');
            const clientesBase44 = await base44.entities.Cliente.list();
            console.log(`[sincronizarClientesOmie] Total Base44: ${clientesBase44.length}`);

            console.log('[sincronizarClientesOmie] Buscando clientes no Omie...');
            const clientesOmie = await buscarClientesOmie();
            console.log(`[sincronizarClientesOmie] Total Omie: ${clientesOmie.length}`);

            // Indexar Omie por codigo_cliente_integracao (que é o id do Base44)
            const omieIntegracaoSet = new Set(
                clientesOmie
                    .map(c => c.codigo_cliente_integracao)
                    .filter(Boolean)
            );

            // Indexar Omie por CPF/CNPJ normalizado
            const omieCpfCnpjSet = new Set(
                clientesOmie
                    .map(c => (c.cnpj_cpf || "").replace(/[^\d]/g, ""))
                    .filter(Boolean)
            );

            const faltandoNoOmie = [];
            const jaExistem = [];

            for (const c of clientesBase44) {
                if ((c.status || 'ativo').toLowerCase() !== 'ativo') continue;

                const cpfCnpjNorm = (c.cpf_cnpj || "").replace(/[^\d]/g, "");
                const existePorIntegracao = omieIntegracaoSet.has(c.id);
                const existePorCpfCnpj = cpfCnpjNorm.length >= 11 && omieCpfCnpjSet.has(cpfCnpjNorm);

                if (!existePorIntegracao && !existePorCpfCnpj) {
                    faltandoNoOmie.push({
                        id: c.id,
                        razao_social: c.razao_social,
                        nome_fantasia: c.nome_fantasia,
                        cpf_cnpj: c.cpf_cnpj,
                        status: c.status
                    });
                } else {
                    jaExistem.push(c.id);
                }
            }

            return Response.json({
                modo: "verificar",
                total_base44: clientesBase44.length,
                total_omie: clientesOmie.length,
                faltando_no_omie: faltandoNoOmie.length,
                ja_existem_no_omie: jaExistem.length,
                clientes_faltando: faltandoNoOmie
            });
        }

        // MODO: sincronizar — envia em lotes os clientes que faltam
        if (modo === "sincronizar") {
            if (!ids_para_enviar || !Array.isArray(ids_para_enviar)) {
                return Response.json({ error: 'Informe ids_para_enviar' }, { status: 400 });
            }

            const LOTE_MAX = 50;
            const loteIds = ids_para_enviar.slice(lote_inicio, lote_inicio + LOTE_MAX);

            if (loteIds.length === 0) {
                return Response.json({ concluido: true, resumo: { total: 0, sucessos: 0, erros: 0 }, resultados: [] });
            }

            const todosClientes = await base44.entities.Cliente.list();
            const clientesParaEnviar = todosClientes.filter(c => loteIds.includes(c.id));

            const resultados = [];
            const delay = (ms) => new Promise(r => setTimeout(r, ms));

            for (const cliente of clientesParaEnviar) {
                const clienteOmie = mapearClienteParaOmie(cliente);
                try {
                    const response = await fetch(OMIE_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            call: "UpsertCliente",
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
                        mensagem: resultado.faultstring || resultado.descricao_status || "Enviado com sucesso"
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
                await delay(800);
            }

            const sucessos = resultados.filter(r => r.sucesso).length;
            const erros = resultados.filter(r => !r.sucesso).length;
            const proximoLote = lote_inicio + LOTE_MAX;
            const concluido = proximoLote >= ids_para_enviar.length;

            return Response.json({
                concluido,
                proximo_lote: concluido ? null : proximoLote,
                resumo: { total: resultados.length, sucessos, erros },
                resultados
            });
        }

        return Response.json({ error: 'Modo inválido. Use "verificar" ou "sincronizar"' }, { status: 400 });

    } catch (error) {
        console.error('Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});