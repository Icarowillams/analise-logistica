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

        const body = await req.json();
        const { pedido_id, etapa } = body;

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

        const codigoPedidoOmie = Number(pedido.omie_codigo_pedido);
        // Omie NÃO permite TrocarEtapaPedido para "50" (Faturar) via API.
        // A etapa 50 só é feita pelo processo de faturamento interno do Omie.
        // Então usamos etapa "20" (Separar) como default ao liberar.
        const etapaDestino = etapa || "20";

        console.log('[faturarPedidoOmie] Pedido:', pedido.id, '- Código Omie:', codigoPedidoOmie, '- Etapa destino:', etapaDestino);

        const payload = {
            call: "TrocarEtapaPedido",
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{
                codigo_pedido: codigoPedidoOmie,
                etapa: etapaDestino
            }]
        };
        console.log('[faturarPedidoOmie] Payload:', JSON.stringify(payload));

        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const resultadoText = await response.text();
        console.log('[faturarPedidoOmie] Resposta Omie:', resultadoText.substring(0, 2000));

        let resultado;
        try {
            resultado = JSON.parse(resultadoText);
        } catch (e) {
            return Response.json({
                sucesso: false,
                erro: 'Resposta inválida do Omie: ' + resultadoText.substring(0, 500)
            });
        }

        // Verificar erro: codigo_status != "0" indica falha
        if (resultado.faultstring || resultado.faultcode) {
            const erro = resultado.faultstring || resultado.faultcode;
            console.error('[faturarPedidoOmie] Erro Omie:', erro);
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: erro });
            return Response.json({ sucesso: false, erro });
        }

        if (resultado.codigo_status && resultado.codigo_status !== "0") {
            const erro = resultado.descricao_status || 'Erro desconhecido do Omie';
            console.error('[faturarPedidoOmie] Erro Omie (status):', erro);
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: erro });
            return Response.json({ sucesso: false, erro });
        }

        // Sucesso
        await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: null });
        console.log('[faturarPedidoOmie] Etapa alterada com sucesso!');

        return Response.json({
            sucesso: true,
            mensagem: resultado.descricao_status || `Pedido movido para etapa ${etapaDestino} no Omie`
        });

    } catch (error) {
        console.error('[faturarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});