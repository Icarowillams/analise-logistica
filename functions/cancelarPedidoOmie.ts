import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { omie_codigo_pedido } = body;

        if (!omie_codigo_pedido) {
            return Response.json({ sucesso: true, mensagem: 'Pedido não estava no Omie' });
        }

        const codigoPedido = Number(omie_codigo_pedido);
        console.log('[cancelarPedidoOmie] Excluindo pedido Omie:', codigoPedido);

        // Usar ExcluirPedido para excluir o pedido no Omie
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ExcluirPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_pedido: codigoPedido
                }]
            })
        });

        const resultText = await response.text();
        console.log('[cancelarPedidoOmie] Resposta ExcluirPedido:', resultText.substring(0, 1000));

        let result;
        try {
            result = JSON.parse(resultText);
        } catch (e) {
            return Response.json({ sucesso: false, erro: 'Resposta inválida do Omie' });
        }

        if (result.faultstring || result.faultcode) {
            const erro = result.faultstring || result.faultcode;
            console.error('[cancelarPedidoOmie] Erro:', erro);
            return Response.json({ sucesso: false, erro });
        }

        console.log('[cancelarPedidoOmie] Pedido excluído com sucesso no Omie!');
        return Response.json({ sucesso: true, mensagem: 'Pedido excluído no Omie' });

    } catch (error) {
        console.error('[cancelarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});