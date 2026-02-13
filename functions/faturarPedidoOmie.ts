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
        const { pedido_id } = body;

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
        console.log('[faturarPedidoOmie] Pedido:', pedido.id, '- Código Omie:', codigoPedidoOmie);

        // Primeiro: consultar o pedido no Omie para obter dados atuais
        console.log('[faturarPedidoOmie] Consultando pedido no Omie...');
        const consultaResponse = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ConsultarPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{ codigo_pedido: codigoPedidoOmie }]
            })
        });

        const pedidoOmie = await consultaResponse.json();
        
        if (pedidoOmie.faultstring) {
            console.error('[faturarPedidoOmie] Erro ao consultar pedido:', pedidoOmie.faultstring);
            return Response.json({ sucesso: false, erro: pedidoOmie.faultstring });
        }

        console.log('[faturarPedidoOmie] Etapa atual do pedido no Omie:', pedidoOmie.pedido_venda_produto?.cabecalho?.etapa);

        // Segundo: alterar o pedido para etapa 50 usando AlterarPedidoVenda
        // Precisamos enviar a estrutura completa do pedido com a etapa alterada
        const pedidoAlterado = pedidoOmie.pedido_venda_produto;
        pedidoAlterado.cabecalho.etapa = "50";

        // Remover campos somente-leitura que podem causar erro
        delete pedidoAlterado.infoCadastro;
        delete pedidoAlterado.total_pedido;
        if (pedidoAlterado.cabecalho) {
            delete pedidoAlterado.cabecalho.numero_pedido;
            delete pedidoAlterado.cabecalho.bloqueado;
            delete pedidoAlterado.cabecalho.importado_api;
            delete pedidoAlterado.cabecalho.origem_pedido;
        }

        console.log('[faturarPedidoOmie] Alterando pedido para etapa 50...');
        
        const alterarResponse = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "AlterarPedidoVenda",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [pedidoAlterado]
            })
        });

        const resultadoText = await alterarResponse.text();
        console.log('[faturarPedidoOmie] Resposta AlterarPedidoVenda:', resultadoText.substring(0, 2000));

        let resultado;
        try {
            resultado = JSON.parse(resultadoText);
        } catch (e) {
            return Response.json({
                sucesso: false,
                erro: 'Resposta inválida do Omie: ' + resultadoText.substring(0, 500)
            });
        }

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
        console.log('[faturarPedidoOmie] Pedido movido para Faturar com sucesso!');

        return Response.json({
            sucesso: true,
            mensagem: resultado.descricao_status || 'Pedido movido para Faturar no Omie'
        });

    } catch (error) {
        console.error('[faturarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});