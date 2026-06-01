import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { codigo_produto, campos } = body;

        if (!codigo_produto || !campos) {
            return Response.json({ error: 'Informe codigo_produto (numerico do Omie) e campos {}' }, { status: 400 });
        }

        const payload = {
            codigo_produto,
            ...campos
        };

        console.log('[corrigirProdutoOmie] Payload:', JSON.stringify(payload));

        const response = await fetch("https://app.omie.com.br/api/v1/geral/produtos/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "AlterarProduto",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [payload]
            })
        });

        const result = await response.json();
        console.log('[corrigirProdutoOmie] Resultado:', JSON.stringify(result));

        if (result.faultstring) {
            return Response.json({ sucesso: false, erro: result.faultstring });
        }

        return Response.json({ sucesso: true, resultado: result });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});