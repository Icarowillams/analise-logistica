import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

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
            return Response.json({ error: 'Apenas administradores podem liberar pedidos no Omie' }, { status: 403 });
        }

        const body = await req.json();
        const { pedido_id } = body;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        // Se não foi enviado ao Omie, não há o que liberar lá
        if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
            console.log('[liberarPedidoOmie] Pedido não enviado ao Omie, ignorando:', pedido_id);
            return Response.json({ sucesso: true, mensagem: 'Pedido não está no Omie, liberação apenas local' });
        }

        // Troca não vai para o Omie
        if (pedido.tipo === 'troca') {
            return Response.json({ sucesso: true, mensagem: 'Pedido de Troca não integra com Omie' });
        }

        console.log('[liberarPedidoOmie] Alterando etapa do pedido', pedido.omie_codigo_pedido, 'para 20 (Pedidos Liberados)');

        // Alterar etapa do pedido no Omie para "20" (Pedidos Liberados / Separar)
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "TrocarEtapaPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_pedido: pedido.omie_codigo_pedido,
                    etapa: "20"
                }]
            })
        });

        const resultado = await response.json();
        console.log('[liberarPedidoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            console.error('[liberarPedidoOmie] Erro Omie:', resultado.faultstring);
            return Response.json({ sucesso: false, erro: resultado.faultstring });
        }

        console.log('[liberarPedidoOmie] Pedido liberado no Omie com sucesso!');
        return Response.json({ sucesso: true, mensagem: 'Pedido movido para Pedidos Liberados no Omie' });

    } catch (error) {
        console.error('[liberarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message, sucesso: false }, { status: 500 });
    }
});