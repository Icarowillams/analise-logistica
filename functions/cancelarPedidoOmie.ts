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
        const { pedido_id, motivo } = body;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        if (!motivo || !motivo.trim()) {
            return Response.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 });
        }

        // Buscar pedido
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        let omieCancelado = false;
        let omieErro = null;

        // Excluir no Omie se foi enviado
        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
            const codigoPedido = Number(pedido.omie_codigo_pedido);
            console.log('[cancelarPedidoOmie] Excluindo pedido Omie:', codigoPedido);

            // Usar ExcluirPedido - método correto da API Omie para cancelar/excluir pedidos
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
            try { result = JSON.parse(resultText); } catch (e) { /* continua */ }

            if (result && !result.faultstring && !result.faultcode) {
                omieCancelado = true;
                console.log('[cancelarPedidoOmie] Sucesso ao excluir pedido no Omie!');
            } else {
                omieErro = result?.faultstring || 'Falha ao excluir no Omie';
                console.error('[cancelarPedidoOmie] Erro Omie:', omieErro);
            }
        }

        // Buscar nome do funcionário pelo email
        let nomeUsuario = user.full_name || user.email;
        try {
            const vendedores = await base44.asServiceRole.entities.Vendedor.filter({ email: user.email });
            if (vendedores.length > 0) {
                nomeUsuario = vendedores[0].nome;
            }
        } catch (e) { /* usa full_name como fallback */ }

        // Atualizar pedido no Base44 como cancelado
        await base44.asServiceRole.entities.Pedido.update(pedido_id, {
            status: 'cancelado',
            cancelado_por: user.email,
            cancelado_por_nome: nomeUsuario,
            data_cancelamento: new Date().toISOString(),
            motivo_cancelamento: motivo.trim(),
            omie_erro: omieErro
        });

        console.log('[cancelarPedidoOmie] Pedido cancelado localmente. Omie excluído:', omieCancelado);

        return Response.json({
            sucesso: true,
            omie_cancelado: omieCancelado,
            omie_erro: omieErro,
            mensagem: omieCancelado
                ? 'Pedido cancelado no sistema e excluído no Omie'
                : (pedido.omie_enviado ? `Pedido cancelado no sistema. Omie: ${omieErro || 'não enviado'}` : 'Pedido cancelado no sistema')
        });

    } catch (error) {
        console.error('[cancelarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});