import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

async function logOmie(base44, payload) {
    try {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create(payload);
    } catch (_) {}
}

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

function normalizarCEP(cep) {
    const limpo = (cep || '').replace(/\D/g, '');
    return limpo.substring(0, 8);
}

function normalizarCpfCnpj(doc) {
    return (doc || '').replace(/[.\-\/\s]/g, '');
}

function removerAspas(val) {
    if (typeof val !== 'string') return val;
    let v = val.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

function limparCamposTexto(obj) {
    const limpo = {};
    for (const [key, value] of Object.entries(obj)) {
        limpo[key] = typeof value === 'string' ? removerAspas(value) : value;
    }
    return limpo;
}

function mapearClienteParaOmie(clienteData, rotaNome) {
    // Aceitar tanto cnpj_cpf (nome real da entidade) quanto cpf_cnpj (legado)
    const cnpjCpfLimpo = normalizarCpfCnpj(clienteData.cnpj_cpf || clienteData.cpf_cnpj);
    const estadoNorm = normalizarEstado(clienteData.estado);
    const cepNorm = normalizarCEP(clienteData.cep);
    const isPessoaFisica = cnpjCpfLimpo.length <= 11;

    // Mapeamento completo conforme documentação Omie API - clientes_cadastro
    const clienteOmie = {
        // --- Identificação ---
        codigo_cliente_integracao: clienteData.codigo || clienteData.id,
        
        // --- Dados principais ---
        razao_social: (clienteData.razao_social || clienteData.nome_fantasia || "Cliente sem nome").substring(0, 60),
        nome_fantasia: (clienteData.nome_fantasia || clienteData.razao_social || "").substring(0, 100),
        cnpj_cpf: cnpjCpfLimpo,
        pessoa_fisica: isPessoaFisica ? "S" : "N",
        
        // --- Endereço ---
        endereco: (clienteData.endereco || "").substring(0, 60),
        endereco_numero: (clienteData.numero || "S/N").substring(0, 10),
        bairro: (clienteData.bairro || "").substring(0, 60),
        complemento: "",
        cidade: (clienteData.cidade || "").substring(0, 60),
        estado: estadoNorm,
        cep: cepNorm,

        // --- Contato ---
        contato: "",
        email: (clienteData.email || "nfe@paoemel.com.br").substring(0, 500),

        // --- Tributação ---
        contribuinte: isPessoaFisica ? "N" : "S",
        inscricao_estadual: clienteData.inscricao_estadual || "",
        
        // --- Observações ---
        observacao: "",
        
        // --- Inatividade ---
        inativo: (clienteData.status || 'ativo').toLowerCase() === 'inativo' ? "S" : "N",

        // --- Tags (código do cliente) ---
        tags: clienteData.codigo ? [{ tag: `COD:${clienteData.codigo}` }] : [],

        // --- Características (nome da rota) ---
        caracteristicas: rotaNome ? [{ campo: "Rotas", conteudo: rotaNome }] : []
    };

    // Remover campos vazios para não sobrescrever dados no Omie com strings vazias
    // Mantemos sempre: codigo_cliente_integracao, razao_social, pessoa_fisica, contribuinte, inativo
    const camposSempreEnviar = ['codigo_cliente_integracao', 'razao_social', 'pessoa_fisica', 'contribuinte', 'inativo', 'inscricao_estadual'];
    
    for (const [key, value] of Object.entries(clienteOmie)) {
        if (camposSempreEnviar.includes(key)) continue;
        if (value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
            delete clienteOmie[key];
        }
    }

    return clienteOmie;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        // Automação de entidade envia: { event, data, old_data, payload_too_large }
        const { event, data: cliente } = body;

        console.log('[enviarClienteOmie] Payload recebido:', JSON.stringify(body).substring(0, 500));
        console.log('[enviarClienteOmie] Event:', JSON.stringify(event));

        // Se payload_too_large ou data veio vazio, buscar dados do cliente via SDK
        let clienteData = cliente;
        if ((body.payload_too_large || !clienteData || !clienteData.razao_social) && event?.entity_id) {
            console.log('[enviarClienteOmie] Buscando cliente via SDK, entity_id:', event.entity_id);
            clienteData = await base44.asServiceRole.entities.Cliente.get(event.entity_id);
            console.log('[enviarClienteOmie] Cliente encontrado via SDK:', clienteData?.razao_social);
        }

        if (!clienteData || (!clienteData.id && !event?.entity_id)) {
            console.log('[enviarClienteOmie] Cliente não informado no payload');
            return Response.json({ error: 'Cliente não informado' }, { status: 400 });
        }

        // Usar o ID do evento se não vier no data
        if (!clienteData.id && event?.entity_id) {
            clienteData.id = event.entity_id;
        }

        // REGRA D1: cliente com tipo_nota = 'D1' NÃO vai para o Omie
        if (clienteData.tipo_nota === 'D1') {
            console.log('[enviarClienteOmie] Cliente D1 — não envia ao Omie:', clienteData.razao_social);
            await logOmie(base44, {
                endpoint: 'geral/clientes',
                call: 'UpsertCliente',
                operacao: 'enviar_cliente',
                entidade_tipo: 'Cliente',
                entidade_id: clienteData.id,
                status: 'warning',
                mensagem_erro: 'Cliente D1 — envio ao Omie ignorado por regra de negócio',
                tentativas: 0
            });
            return Response.json({ sucesso: true, pulado: true, motivo: 'cliente_d1' });
        }

        // Limpar aspas de todos os campos texto
        clienteData = limparCamposTexto(clienteData);

        console.log('[enviarClienteOmie] Cliente a enviar:', clienteData.razao_social, '- Status:', clienteData.status, '- ID:', clienteData.id);

        // Buscar nome da rota se o cliente tem rota_id
        let rotaNome = '';
        if (clienteData.rota_id) {
            try {
                const rota = await base44.asServiceRole.entities.Rota.get(clienteData.rota_id);
                if (rota) rotaNome = rota.nome || '';
            } catch (e) {
                console.log('[enviarClienteOmie] Erro ao buscar rota:', e.message);
            }
        }

        // Mapear campos do Base44 para formato Omie completo
        const clienteOmie = mapearClienteParaOmie(clienteData, rotaNome);

        // Pré-consulta por CNPJ: se já existe no Omie, reutilizar o codigo_cliente_integracao existente
        // para evitar erro "Cliente já cadastrado... (add)" quando a integração antiga foi criada com outro ID.
        const cnpjLimpo = clienteOmie.cnpj_cpf;
        if (cnpjLimpo) {
            try {
                const consulta = await fetch(OMIE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        call: 'ListarClientes',
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{
                            pagina: 1,
                            registros_por_pagina: 1,
                            apenas_importado_api: 'N',
                            clientesFiltro: { cnpj_cpf: cnpjLimpo }
                        }]
                    })
                });
                const achado = await consulta.json();
                const existente = achado?.clientes_cadastro?.[0];
                if (existente?.codigo_cliente_omie) {
                    if (existente.codigo_cliente_integracao && existente.codigo_cliente_integracao !== clienteOmie.codigo_cliente_integracao) {
                        console.log('[enviarClienteOmie] Reutilizando codigo_cliente_integracao existente no Omie:', existente.codigo_cliente_integracao);
                        clienteOmie.codigo_cliente_integracao = existente.codigo_cliente_integracao;
                    }
                    clienteOmie.codigo_cliente_omie = existente.codigo_cliente_omie;
                }
            } catch (e) {
                console.log('[enviarClienteOmie] Pré-consulta CNPJ falhou (segue fluxo normal):', e.message);
            }
        }

        console.log('[enviarClienteOmie] Payload Omie:', JSON.stringify(clienteOmie).substring(0, 800));

        const startedAt = Date.now();
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
        const duracao_ms = Date.now() - startedAt;

        console.log('[enviarClienteOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            console.error('[enviarClienteOmie] Erro Omie:', resultado.faultstring);
            await logOmie(base44, {
                endpoint: 'geral/clientes',
                call: 'UpsertCliente',
                operacao: 'enviar_cliente',
                entidade_tipo: 'Cliente',
                entidade_id: clienteData.id,
                status: 'erro',
                codigo_erro: resultado.faultcode,
                mensagem_erro: resultado.faultstring,
                payload_enviado: JSON.stringify(clienteOmie).slice(0, 5000),
                payload_resposta: JSON.stringify(resultado).slice(0, 5000),
                duracao_ms,
                tentativas: 1
            });
            return Response.json({
                sucesso: false,
                erro: resultado.faultstring,
                cliente_id: clienteData.id
            });
        }

        // Sucesso: gravar codigo_omie de volta no Cliente
        const codigoOmie = resultado.codigo_cliente_omie;
        if (codigoOmie && clienteData.id) {
            try {
                await base44.asServiceRole.entities.Cliente.update(clienteData.id, {
                    codigo_omie: String(codigoOmie)
                });
            } catch (e) {
                console.log('[enviarClienteOmie] Falha gravando codigo_omie:', e.message);
            }
        }

        await logOmie(base44, {
            endpoint: 'geral/clientes',
            call: 'UpsertCliente',
            operacao: 'enviar_cliente',
            entidade_tipo: 'Cliente',
            entidade_id: clienteData.id,
            status: 'sucesso',
            payload_enviado: JSON.stringify(clienteOmie).slice(0, 5000),
            payload_resposta: JSON.stringify(resultado).slice(0, 5000),
            duracao_ms,
            tentativas: 1
        });

        console.log('[enviarClienteOmie] Cliente enviado:', clienteData.razao_social, '- Omie:', codigoOmie);
        return Response.json({
            sucesso: true,
            cliente_id: clienteData.id,
            codigo_omie: codigoOmie,
            mensagem: resultado.descricao_status || "Cliente enviado com sucesso"
        });

    } catch (error) {
        console.error('Erro ao enviar cliente para Omie:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});