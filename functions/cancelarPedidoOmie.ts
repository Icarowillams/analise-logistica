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

        // Cancelar no Omie se foi enviado
        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
            const codigoPedido = Number(pedido.omie_codigo_pedido);
            console.log('[cancelarPedidoOmie] Cancelando pedido Omie:', codigoPedido);

            // Tentativa 1: TrocarEtapaPedido para etapa 60 (Cancelado)
            const response1 = await fetch(OMIE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "TrocarEtapaPedido",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{
                        codigo_pedido: codigoPedido,
                        etapa: "60"
                    }]
                })
            });

            const result1Text = await response1.text();
            console.log('[cancelarPedidoOmie] Resposta TrocarEtapaPedido:', result1Text.substring(0, 1000));

            let result1;
            try { result1 = JSON.parse(result1Text); } catch (e) { /* continua */ }

            const desc1 = result1?.descricao_status || '';
            const isSuccess1 = result1 && !result1.faultstring && !result1.faultcode
                && !desc1.toLowerCase().includes('não é possível');

            if (isSuccess1) {
                omieCancelado = true;
                console.log('[cancelarPedidoOmie] Sucesso com TrocarEtapaPedido!');
            } else {
                console.log('[cancelarPedidoOmie] TrocarEtapaPedido falhou, tentando AlterarPedidoVenda...');

                // Tentativa 2: ConsultarPedido + AlterarPedidoVenda com etapa 60
                const consultaResp = await fetch(OMIE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: "ConsultarPedido",
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{ codigo_pedido: codigoPedido }]
                    })
                });

                const consultaText = await consultaResp.text();
                let pedidoOmie;
                try { pedidoOmie = JSON.parse(consultaText); } catch (e) { /* */ }

                if (pedidoOmie && !pedidoOmie.faultstring) {
                    const pedidoData = pedidoOmie.pedido_venda_produto || pedidoOmie;
                    const pedidoParaAlterar = JSON.parse(JSON.stringify(pedidoData));

                    if (pedidoParaAlterar.cabecalho) {
                        pedidoParaAlterar.cabecalho.etapa = "60";
                        delete pedidoParaAlterar.cabecalho.numero_pedido;
                        delete pedidoParaAlterar.cabecalho.origem_pedido;
                        delete pedidoParaAlterar.cabecalho.bloqueado;
                        delete pedidoParaAlterar.cabecalho.importado_api;
                        delete pedidoParaAlterar.cabecalho.quantidade_itens;
                    }

                    const camposRemover = ['infoCadastro', 'exportacao', 'total_pedido', 'MarketPlace', 'marketplace', 'lista_parcelas'];
                    camposRemover.forEach(c => delete pedidoParaAlterar[c]);

                    if (pedidoParaAlterar.det) {
                        pedidoParaAlterar.det = pedidoParaAlterar.det.map(item => {
                            delete item.infAdic;
                            delete item.inf_adic;
                            delete item.rastreabilidade;
                            delete item.imposto;
                            return item;
                        });
                    }

                    const response2 = await fetch(OMIE_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            call: "AlterarPedidoVenda",
                            app_key: OMIE_APP_KEY,
                            app_secret: OMIE_APP_SECRET,
                            param: [pedidoParaAlterar]
                        })
                    });

                    const result2Text = await response2.text();
                    console.log('[cancelarPedidoOmie] Resposta AlterarPedidoVenda:', result2Text.substring(0, 1000));

                    let result2;
                    try { result2 = JSON.parse(result2Text); } catch (e) { /* */ }

                    if (result2 && !result2.faultstring && !result2.faultcode) {
                        omieCancelado = true;
                        console.log('[cancelarPedidoOmie] Sucesso com AlterarPedidoVenda!');
                    } else {
                        omieErro = result2?.faultstring || 'Falha ao cancelar no Omie';
                        console.error('[cancelarPedidoOmie] Erro:', omieErro);
                    }
                } else {
                    omieErro = pedidoOmie?.faultstring || 'Falha ao consultar pedido no Omie';
                }
            }
        }

        // Atualizar pedido no Base44 como cancelado
        await base44.asServiceRole.entities.Pedido.update(pedido_id, {
            status: 'cancelado',
            cancelado_por: user.email,
            data_cancelamento: new Date().toISOString(),
            motivo_cancelamento: motivo.trim(),
            omie_erro: omieErro
        });

        console.log('[cancelarPedidoOmie] Pedido cancelado localmente. Omie cancelado:', omieCancelado);

        return Response.json({
            sucesso: true,
            omie_cancelado: omieCancelado,
            omie_erro: omieErro,
            mensagem: omieCancelado
                ? 'Pedido cancelado no sistema e no Omie'
                : (pedido.omie_enviado ? `Pedido cancelado no sistema. Omie: ${omieErro || 'não enviado'}` : 'Pedido cancelado no sistema')
        });

    } catch (error) {
        console.error('[cancelarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});