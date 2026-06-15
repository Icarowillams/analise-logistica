import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/vendedores/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        // Dados do evento de automação
        const { event, data } = body;
        
        if (!data) {
            return Response.json({ error: 'Dados não fornecidos' }, { status: 400 });
        }

        const vendedor = data;

        // Verificar se é um vendedor (função contém "vendedor")
        if (!vendedor.funcao?.toLowerCase().includes('vendedor')) {
            return Response.json({ 
                ignorado: true, 
                mensagem: 'Funcionário não é vendedor, ignorando envio ao Omie' 
            });
        }

        // Montar objeto para Omie
        const vendedorOmie = {
            codInt: vendedor.id.substring(0, 30),
            nome: (vendedor.nome || "Vendedor sem nome").substring(0, 70),
            email: (vendedor.email || "").substring(0, 100),
            inativo: vendedor.status === 'inativo' ? "S" : "N",
            fatura_pedido: "S",
            visualiza_pedido: "N",
            comissao: 0.5
        };

        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "UpsertVendedor",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [vendedorOmie]
            })
        });

        if (response.status >= 500 || response.status === 429 || response.status === 425) {
            const corpo = await response.text().catch(() => '');
            return Response.json({ sucesso: false, erro: `HTTP ${response.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}` }, { status: response.status === 425 ? 425 : 503 });
        }
        const resultado = await response.json();

        if (resultado.faultstring) {
            console.error('Erro Omie:', resultado.faultstring);
            return Response.json({ 
                sucesso: false, 
                erro: resultado.faultstring 
            });
        }

        console.log('Vendedor enviado ao Omie com sucesso:', vendedor.nome);
        return Response.json({ 
            sucesso: true, 
            codigo_omie: resultado.codigo,
            mensagem: 'Vendedor enviado ao Omie com sucesso'
        });

    } catch (error) {
        console.error('Erro ao enviar vendedor:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});