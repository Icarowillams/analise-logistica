import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/vendedores/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        const { event, data: vendedor } = body;

        if (!vendedor || !vendedor.id) {
            return Response.json({ error: 'Vendedor não informado' }, { status: 400 });
        }

        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ExcluirVendedor",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codInt: vendedor.id.substring(0, 30)
                }]
            })
        });

        const resultado = await response.json();

        if (resultado.faultstring) {
            console.error('Erro Omie ao excluir vendedor:', resultado.faultstring);
            return Response.json({ 
                sucesso: false, 
                erro: resultado.faultstring 
            });
        }

        console.log('Vendedor excluído do Omie:', vendedor.nome);
        return Response.json({ 
            sucesso: true, 
            mensagem: 'Vendedor excluído do Omie com sucesso'
        });

    } catch (error) {
        console.error('Erro ao excluir vendedor:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});