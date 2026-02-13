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
            return Response.json({ error: 'Apenas administradores podem faturar pedidos' }, { status: 403 });
        }

        const { pedido_id } = await req.json();
        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        // Buscar pedido
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
            return Response.json({ error: 'Este pedido ainda não foi enviado ao Omie' }, { status: 400 });
        }

        console.log('[faturarPedidoOmie] Alterando etapa do pedido:', pedido.id, '- Código Omie:', pedido.omie_codigo_pedido);

        // Alterar etapa do pedido no Omie para 50 (Faturar)
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "TrocarEtapaPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    nCodPed: pedido.omie_codigo_pedido,
                    cEtapa: "50"
                }]
            })
        });

        const resultado = await response.json();
        console.log('[faturarPedidoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 1000));

        if (resultado.faultstring) {
            console.error('[faturarPedidoOmie] Erro Omie:', resultado.faultstring);

            await base44.asServiceRole.entities.Pedido.update(pedido_id, {
                omie_erro: resultado.faultstring
            });

            return Response.json({
                sucesso: false,
                erro: resultado.faultstring
            });
        }

        // Atualizar pedido no Base44
        await base44.asServiceRole.entities.Pedido.update(pedido_id, {
            omie_erro: null
        });

        console.log('[faturarPedidoOmie] Pedido movido para Faturar com sucesso!');

        return Response.json({
            sucesso: true,
            mensagem: resultado.cDescStatus || 'Pedido movido para Faturar no Omie'
        });

    } catch (error) {
        console.error('[faturarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});