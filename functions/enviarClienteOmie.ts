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

        console.log('[enviarClienteOmie] Payload recebido:', JSON.stringify(body).substring(0, 500));
        console.log('[enviarClienteOmie] Event:', JSON.stringify(event));

        // Se payload_too_large, buscar dados do cliente via SDK
        let clienteData = cliente;
        if (body.payload_too_large && event?.entity_id) {
            console.log('[enviarClienteOmie] Payload muito grande, buscando cliente via SDK...');
            const clientes = await base44.asServiceRole.entities.Cliente.filter({ id: event.entity_id });
            clienteData = clientes?.[0] || cliente;
        }

        if (!clienteData || (!clienteData.id && !event?.entity_id)) {
            console.log('[enviarClienteOmie] Cliente não informado no payload');
            return Response.json({ error: 'Cliente não informado' }, { status: 400 });
        }

        // Se o data veio vazio mas temos o entity_id, buscar
        if (!clienteData?.razao_social && event?.entity_id) {
            console.log('[enviarClienteOmie] Data vazio, buscando cliente pelo entity_id:', event.entity_id);
            const clientes = await base44.asServiceRole.entities.Cliente.filter({});
            clienteData = clientes.find(c => c.id === event.entity_id);
            if (!clienteData) {
                console.log('[enviarClienteOmie] Cliente não encontrado pelo entity_id');
                return Response.json({ error: 'Cliente não encontrado' }, { status: 404 });
            }
        }

        // Usar o ID do evento se não vier no data
        if (!clienteData.id && event?.entity_id) {
            clienteData.id = event.entity_id;
        }

        console.log('[enviarClienteOmie] Cliente a enviar:', clienteData.razao_social, '- Status:', clienteData.status, '- ID:', clienteData.id);

        // Só enviar clientes ativos para o Omie (tratar vazio/undefined como ativo)
        const statusCliente = (clienteData.status || 'ativo').toLowerCase().trim();
        if (statusCliente === 'inativo') {
            console.log('[enviarClienteOmie] Cliente ignorado (inativo):', clienteData.razao_social);
            return Response.json({ 
                sucesso: false, 
                ignorado: true,
                mensagem: 'Cliente está inativo, não será enviado ao Omie'
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

        // Normalizar CEP (apenas dígitos, 8 caracteres)
        let cepNormalizado = (cliente.cep || '').replace(/\D/g, '');
        if (cepNormalizado.length > 8) cepNormalizado = cepNormalizado.substring(0, 8);

        // Normalizar CPF/CNPJ (remover pontuação)
        const cnpjCpfLimpo = (cliente.cpf_cnpj || '').replace(/[.\-\/\s]/g, '');

        // Mapear campos do Base44 para Omie
        const clienteOmie = {
            codigo_cliente_integracao: cliente.id,
            razao_social: (cliente.razao_social || cliente.nome_fantasia || "Cliente sem nome").substring(0, 60),
            nome_fantasia: (cliente.nome_fantasia || cliente.razao_social || "").substring(0, 100),
            cnpj_cpf: cnpjCpfLimpo,
            email: "",
            endereco: (cliente.endereco || "").substring(0, 60),
            endereco_numero: (cliente.numero || "").substring(0, 10),
            bairro: (cliente.bairro || "").substring(0, 60),
            cidade: (cliente.cidade || "").substring(0, 60),
            estado: estadoNormalizado,
            cep: cepNormalizado,
            pessoa_fisica: (cnpjCpfLimpo.length <= 11) ? "S" : "N"
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