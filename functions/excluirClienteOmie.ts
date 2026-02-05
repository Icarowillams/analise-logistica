import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        const { event, data: cliente } = body;

        if (!cliente || !cliente.id) {
            return Response.json({ error: 'Cliente não informado' }, { status: 400 });
        }

        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ExcluirCliente",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_cliente_integracao: cliente.id
                }]
            })
        });

        const resultado = await response.json();

        if (resultado.faultstring) {
            console.error('Erro Omie ao excluir:', resultado.faultstring);
            return Response.json({ 
                sucesso: false, 
                erro: resultado.faultstring 
            });
        }

        console.log('Cliente excluído do Omie:', cliente.razao_social);
        return Response.json({ 
            sucesso: true, 
            mensagem: 'Cliente excluído do Omie com sucesso'
        });

    } catch (error) {
        console.error('Erro ao excluir cliente:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});