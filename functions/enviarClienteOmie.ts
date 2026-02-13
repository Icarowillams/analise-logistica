import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        // Automação de entidade envia: { event, data, old_data }
        const { event, data: cliente } = body;

        if (!cliente || !cliente.id) {
            return Response.json({ error: 'Cliente não informado' }, { status: 400 });
        }

        // Só enviar clientes ativos para o Omie
        if (cliente.status !== 'ativo') {
            console.log('Cliente ignorado (não ativo):', cliente.razao_social, '- Status:', cliente.status);
            return Response.json({ 
                sucesso: false, 
                ignorado: true,
                mensagem: 'Cliente não está ativo, não será enviado ao Omie'
            });
        }

        // Mapear nome completo do estado para sigla UF
        const estadoParaUF = {
            'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
            'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES',
            'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
            'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
            'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
            'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
            'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
        };

        let estadoNormalizado = (cliente.estado || '').trim();
        // Se tem mais de 2 caracteres, tentar converter nome completo para sigla
        if (estadoNormalizado.length > 2) {
            const chave = estadoNormalizado.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            estadoNormalizado = estadoParaUF[chave] || estadoNormalizado.substring(0, 2).toUpperCase();
        } else {
            estadoNormalizado = estadoNormalizado.toUpperCase();
        }

        // Mapear campos do Base44 para Omie
        const clienteOmie = {
            codigo_cliente_integracao: cliente.id,
            razao_social: cliente.razao_social || cliente.nome_fantasia || "Cliente sem nome",
            nome_fantasia: cliente.nome_fantasia || cliente.razao_social || "",
            cnpj_cpf: cliente.cpf_cnpj || "",
            email: "",
            endereco: cliente.endereco || "",
            endereco_numero: cliente.numero || "",
            bairro: cliente.bairro || "",
            cidade: cliente.cidade || "",
            estado: estadoNormalizado,
            cep: cliente.cep || "",
            pessoa_fisica: (cliente.cpf_cnpj && cliente.cpf_cnpj.length <= 14) ? "S" : "N"
        };

        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                call: "UpsertCliente",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [clienteOmie]
            })
        });

        const resultado = await response.json();

        if (resultado.faultstring) {
            console.error('Erro Omie:', resultado.faultstring);
            return Response.json({ 
                sucesso: false, 
                erro: resultado.faultstring,
                cliente_id: cliente.id
            });
        }

        console.log('Cliente enviado para Omie:', cliente.razao_social, '- Código Omie:', resultado.codigo_cliente_omie);

        return Response.json({
            sucesso: true,
            cliente_id: cliente.id,
            codigo_omie: resultado.codigo_cliente_omie,
            mensagem: resultado.descricao_status || "Cliente enviado com sucesso"
        });

    } catch (error) {
        console.error('Erro ao enviar cliente para Omie:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});