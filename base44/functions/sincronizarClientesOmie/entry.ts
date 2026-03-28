import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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

function mapearClienteParaOmie(cliente) {
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

// Busca UMA página de clientes do Omie
async function buscarPaginaOmie(pagina, registrosPorPagina = 500) {
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
                apenas_importado_api: "N"
            }]
        })
    });
    return await response.json();
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { modo, lote_inicio = 0, ids_para_enviar = null, pagina_omie = 1, clientes_omie_acumulados = null } = body;

        // ====================================================================
        // MODO: listar_base44 — retorna lista resumida de clientes ativos
        // ====================================================================
        if (modo === "listar_base44") {
            // Paginated fetch using list() with skip — more reliable than filter with skip
            const { pagina_base44 = 1 } = body;
            const PAGE_SIZE = 50;
            const skip = (pagina_base44 - 1) * PAGE_SIZE;
            
            const lote = await base44.asServiceRole.entities.Cliente.list(
                '-created_date',
                PAGE_SIZE,
                skip
            );
            
            const arr = Array.isArray(lote) ? lote : [];
            // Filter active clients on server side
            const resumo = arr
                .filter(c => (c.status || 'ativo') === 'ativo')
                .map(c => ({
                    id: c.id,
                    razao_social: c.razao_social || '',
                    nome_fantasia: c.nome_fantasia || '',
                    cpf_cnpj: c.cpf_cnpj || ''
                }));
            
            const concluido = arr.length < PAGE_SIZE;
            
            return Response.json({ 
                clientes: resumo, 
                count: resumo.length, 
                total_bruto: arr.length,
                concluido,
                pagina: pagina_base44
            });
        }

        // ====================================================================
        // MODO: listar_omie — busca clientes paginados do Omie  
        // Retorna: códigos de integração e CPF/CNPJ de cada página
        // ====================================================================
        if (modo === "listar_omie") {
            console.log(`[sync] Buscando página ${pagina_omie} do Omie...`);
            const data = await buscarPaginaOmie(pagina_omie, 500);

            if (data.faultstring) {
                console.error('[sync] Erro Omie:', data.faultstring);
                return Response.json({ error: data.faultstring }, { status: 500 });
            }

            const clientes = (data.clientes_cadastro || []).map(c => ({
                codigo_integracao: c.codigo_cliente_integracao || '',
                cpf_cnpj: (c.cnpj_cpf || '').replace(/[^\d]/g, '')
            }));

            const totalPaginas = data.total_de_paginas || 1;
            const totalRegistros = data.total_de_registros || 0;

            console.log(`[sync] Página ${pagina_omie}/${totalPaginas}: ${clientes.length} registros (total: ${totalRegistros})`);

            return Response.json({
                pagina: pagina_omie,
                total_paginas: totalPaginas,
                total_registros: totalRegistros,
                clientes,
                concluido: pagina_omie >= totalPaginas
            });
        }

        // ====================================================================
        // MODO: comparar — recebe ambas as listas e retorna os faltantes
        // ====================================================================
        if (modo === "comparar") {
            const { clientes_base44, clientes_omie } = body;

            if (!clientes_base44 || !clientes_omie) {
                return Response.json({ error: 'Informe clientes_base44 e clientes_omie' }, { status: 400 });
            }

            const omieIntegracaoSet = new Set(
                clientes_omie.map(c => c.codigo_integracao).filter(Boolean)
            );
            const omieCpfCnpjSet = new Set(
                clientes_omie.map(c => c.cpf_cnpj).filter(v => v && v.length >= 11)
            );

            const faltando = [];
            const jaExistem = [];

            for (const c of clientes_base44) {
                const cpfNorm = (c.cpf_cnpj || '').replace(/[^\d]/g, '');
                const existePorId = omieIntegracaoSet.has(c.id);
                const existePorCpf = cpfNorm.length >= 11 && omieCpfCnpjSet.has(cpfNorm);

                if (!existePorId && !existePorCpf) {
                    faltando.push(c);
                } else {
                    jaExistem.push(c.id);
                }
            }

            return Response.json({
                total_base44: clientes_base44.length,
                total_omie: clientes_omie.length,
                faltando_no_omie: faltando.length,
                ja_existem_no_omie: jaExistem.length,
                clientes_faltando: faltando
            });
        }

        // ====================================================================
        // MODO: sincronizar — envia em lotes os clientes que faltam
        // ====================================================================
        if (modo === "sincronizar") {
            if (!ids_para_enviar || !Array.isArray(ids_para_enviar)) {
                return Response.json({ error: 'Informe ids_para_enviar' }, { status: 400 });
            }

            const LOTE_MAX = 20;
            const loteIds = ids_para_enviar.slice(lote_inicio, lote_inicio + LOTE_MAX);

            if (loteIds.length === 0) {
                return Response.json({ concluido: true, resumo: { total: 0, sucessos: 0, erros: 0 }, resultados: [] });
            }

            // Buscar dados completos dos clientes deste lote
            const clientesParaEnviar = [];
            for (const id of loteIds) {
                try {
                    const cli = await base44.asServiceRole.entities.Cliente.get(id);
                    if (cli) clientesParaEnviar.push(cli);
                } catch (e) {
                    console.error(`[sync] Erro ao buscar cliente ${id}:`, e.message);
                }
            }

            const resultados = [];
            const delay = (ms) => new Promise(r => setTimeout(r, ms));

            for (const cliente of clientesParaEnviar) {
                const clienteOmie = mapearClienteParaOmie({ ...cliente });
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
                await delay(600);
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

        return Response.json({ error: 'Modo inválido. Use "listar_base44", "listar_omie", "comparar" ou "sincronizar"' }, { status: 400 });

    } catch (error) {
        console.error('Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});