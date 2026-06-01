import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // P7-prep (16/05): permissão granular — admin sempre passa,
        // demais usuários precisam ter `permissoes_pedidos.enviar_pedido` ativo
        // (mesma permissão que já controla envio ao Omie).
        if (user.role !== 'admin') {
            const allVendedores = await base44.asServiceRole.entities.Vendedor.list();
            const vendedor = allVendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
            if (!vendedor) {
                return Response.json({ error: 'Funcionário não encontrado no cadastro' }, { status: 403 });
            }
            const permissoes = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedor.id });
            const perm = permissoes[0];
            if (!perm?.permissoes_pedidos?.enviar_pedido) {
                return Response.json({ error: 'Sem permissão para liberar pedidos' }, { status: 403 });
            }
        }

        const body = await req.json();
        const { pedido_id, etapa } = body;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        // etapa: "10" = Pedido de Venda, "20" = Pedidos Liberados (Separar)
        const etapaOmie = etapa || "20";

        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
            return Response.json({ sucesso: true, mensagem: 'Pedido não está no Omie, operação apenas local' });
        }

        if (pedido.tipo === 'troca') {
            return Response.json({ sucesso: true, mensagem: 'Pedido de Troca não integra com Omie' });
        }

        const codigoPedidoOmie = Number(pedido.omie_codigo_pedido);
        if (!codigoPedidoOmie || isNaN(codigoPedidoOmie)) {
            console.error(`[liberarPedidoOmie] codigo_pedido inválido: ${pedido.omie_codigo_pedido} (tipo: ${typeof pedido.omie_codigo_pedido})`);
            return Response.json({ sucesso: false, erro: `Código do pedido Omie inválido: ${pedido.omie_codigo_pedido}` });
        }

        const etapaLabel = etapaOmie === "20" ? "Pedidos Liberados" : "Pedido de Venda";
        console.log(`[liberarPedidoOmie] Alterando etapa do pedido ${codigoPedidoOmie} para ${etapaOmie} (${etapaLabel})`);

        const payload = {
            call: "TrocarEtapaPedido",
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{
                codigo_pedido: codigoPedidoOmie,
                etapa: etapaOmie
            }]
        };

        console.log('[liberarPedidoOmie] Payload:', JSON.stringify(payload.param[0]));

        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const resultado = await response.json();
        console.log('[liberarPedidoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            console.error('[liberarPedidoOmie] Erro Omie:', resultado.faultstring);
            return Response.json({ sucesso: false, erro: resultado.faultstring });
        }

        console.log(`[liberarPedidoOmie] Pedido ${codigoPedidoOmie} movido para ${etapaLabel} no Omie com sucesso!`);
        return Response.json({ sucesso: true, mensagem: `Pedido movido para ${etapaLabel} no Omie` });

    } catch (error) {
        console.error('[liberarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message, sucesso: false }, { status: 500 });
    }
});