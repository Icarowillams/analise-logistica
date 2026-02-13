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

        // Etapa padrão: 50 (Faturar)
        const etapaDestino = etapa || "50";

        // Buscar pedido
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
            return Response.json({ error: 'Este pedido ainda não foi enviado ao Omie' }, { status: 400 });
        }

        const codigoPedidoOmie = Number(pedido.omie_codigo_pedido);
        console.log('[faturarPedidoOmie] Pedido:', pedido.id, '- Código Omie:', codigoPedidoOmie, '- Etapa destino:', etapaDestino);

        // Tentativa 1: TrocarEtapaPedido
        console.log('[faturarPedidoOmie] Tentativa 1: TrocarEtapaPedido com etapa', etapaDestino);
        const response1 = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "TrocarEtapaPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_pedido: codigoPedidoOmie,
                    etapa: etapaDestino
                }]
            })
        });

        const resultado1Text = await response1.text();
        console.log('[faturarPedidoOmie] Resposta Tentativa 1:', resultado1Text.substring(0, 2000));

        let resultado1;
        try {
            resultado1 = JSON.parse(resultado1Text);
        } catch (e) {
            // continua para tentativa 2
        }

        // Se tentativa 1 deu certo (verificar se não é mensagem de erro disfarçada)
        const descStatus1 = resultado1?.descricao_status || '';
        const isRealSuccess1 = resultado1 && !resultado1.faultstring && !resultado1.faultcode 
            && !descStatus1.toLowerCase().includes('não é possível')
            && !descStatus1.toLowerCase().includes('utilize o processo');
        
        if (isRealSuccess1) {
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: null });
            console.log('[faturarPedidoOmie] Sucesso na Tentativa 1!');
            return Response.json({
                sucesso: true,
                mensagem: descStatus1 || `Pedido movido para etapa ${etapaDestino} no Omie`
            });
        }
        
        console.log('[faturarPedidoOmie] Tentativa 1 falhou:', resultado1?.faultstring || descStatus1);

        // Tentativa 2: Primeiro consultar o pedido no Omie, depois usar AlterarPedidoVenda
        console.log('[faturarPedidoOmie] Tentativa 2: ConsultarPedido + AlterarPedidoVenda');
        
        // Consultar pedido completo no Omie
        const consultaResp = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ConsultarPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{ codigo_pedido: codigoPedidoOmie }]
            })
        });

        const consultaText = await consultaResp.text();
        console.log('[faturarPedidoOmie] ConsultarPedido resposta (primeiros 1000 chars):', consultaText.substring(0, 1000));
        
        let pedidoOmie;
        try {
            pedidoOmie = JSON.parse(consultaText);
        } catch (e) {
            return Response.json({
                sucesso: false,
                erro: 'Falha ao consultar pedido no Omie'
            });
        }

        if (pedidoOmie.faultstring) {
            return Response.json({
                sucesso: false,
                erro: 'Erro ao consultar pedido: ' + pedidoOmie.faultstring
            });
        }

        // Modificar a etapa e enviar via AlterarPedidoVenda
        // Remover campos read-only que causam erro
        const pedidoParaAlterar = JSON.parse(JSON.stringify(pedidoOmie));
        
        // Definir a nova etapa
        if (pedidoParaAlterar.cabecalho) {
            pedidoParaAlterar.cabecalho.etapa = etapaDestino;
        }
        
        // Remover campos que o Omie não aceita em alteração
        delete pedidoParaAlterar.infoCadastro;
        delete pedidoParaAlterar.exportacao;
        delete pedidoParaAlterar.infoCadastro;
        delete pedidoParaAlterar.total_pedido;
        delete pedidoParaAlterar.MarketPlace;
        delete pedidoParaAlterar.marketplace;
        
        // Limpar campos read-only dos itens
        if (pedidoParaAlterar.det) {
            pedidoParaAlterar.det = pedidoParaAlterar.det.map(item => {
                delete item.infAdic;
                delete item.inf_adic;
                delete item.rastreabilidade;
                return item;
            });
        }

        console.log('[faturarPedidoOmie] Enviando AlterarPedidoVenda com etapa:', etapaDestino);
        
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

        const resultado2Text = await response2.text();
        console.log('[faturarPedidoOmie] Resposta Tentativa 2:', resultado2Text.substring(0, 2000));

        let resultado2;
        try {
            resultado2 = JSON.parse(resultado2Text);
        } catch (e) {
            return Response.json({
                sucesso: false,
                erro: 'Resposta inválida do Omie: ' + resultado2Text.substring(0, 500)
            });
        }

        if (resultado2.faultstring || resultado2.faultcode) {
            const erro = resultado2.faultstring || resultado2.faultcode;
            console.error('[faturarPedidoOmie] Erro Omie Tentativa 2:', erro);
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: erro });
            return Response.json({ sucesso: false, erro });
        }

        // Sucesso na tentativa 2
        await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: null });
        console.log('[faturarPedidoOmie] Sucesso na Tentativa 2!');

        return Response.json({
            sucesso: true,
            mensagem: resultado2.descricao_status || `Pedido movido para etapa ${etapaDestino} no Omie`
        });

    } catch (error) {
        console.error('[faturarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});