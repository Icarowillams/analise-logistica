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

        if (user.role !== 'admin') {
            return Response.json({ error: 'Apenas administradores podem cancelar pedidos' }, { status: 403 });
        }

        const body = await req.json();
        const { omie_codigo_pedido } = body;

        if (!omie_codigo_pedido) {
            return Response.json({ sucesso: true, mensagem: 'Pedido não estava no Omie' });
        }

        const codigoPedido = Number(omie_codigo_pedido);
        console.log('[cancelarPedidoOmie] Cancelando pedido Omie:', codigoPedido);

        // Usar StatusPedido para cancelar
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "StatusPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_pedido: codigoPedido,
                    etapa: "60"
                }]
            })
        });

        const resultText = await response.text();
        console.log('[cancelarPedidoOmie] Resposta StatusPedido:', resultText.substring(0, 1000));

        let result;
        try {
            result = JSON.parse(resultText);
        } catch (e) {
            // Tentar via TrocarEtapaPedido como fallback
        }

        // Verificar se deu certo
        if (result && !result.faultstring && !result.faultcode) {
            console.log('[cancelarPedidoOmie] Sucesso com StatusPedido!');
            return Response.json({ sucesso: true, mensagem: 'Pedido cancelado no Omie' });
        }

        console.log('[cancelarPedidoOmie] StatusPedido falhou, tentando CancelarPedidoVenda...');

        // Fallback: CancelarPedidoVenda
        const response2 = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "CancelarPedidoVenda",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_pedido: codigoPedido
                }]
            })
        });

        const result2Text = await response2.text();
        console.log('[cancelarPedidoOmie] Resposta CancelarPedidoVenda:', result2Text.substring(0, 1000));

        let result2;
        try {
            result2 = JSON.parse(result2Text);
        } catch (e) {
            return Response.json({ sucesso: false, erro: 'Resposta inválida do Omie' });
        }

        if (result2.faultstring || result2.faultcode) {
            const erro = result2.faultstring || result2.faultcode;
            console.error('[cancelarPedidoOmie] Erro:', erro);
            return Response.json({ sucesso: false, erro });
        }

        console.log('[cancelarPedidoOmie] Sucesso com CancelarPedidoVenda!');
        return Response.json({ sucesso: true, mensagem: 'Pedido cancelado no Omie' });

    } catch (error) {
        console.error('[cancelarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});