import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { pedido_id } = body;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        // Buscar pedido local
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        // Buscar itens locais
        const itensLocais = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });

        // Buscar pedido no Omie
        const omieResponse = await fetch("https://app.omie.com.br/api/v1/produtos/pedido/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ConsultarPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{ codigo_pedido: Number(pedido.omie_codigo_pedido) }]
            })
        });

        const omieResult = await omieResponse.json();

        if (omieResult.faultstring) {
            return Response.json({ 
                sucesso: false, 
                erro: omieResult.faultstring,
                pedido_local: {
                    numero: pedido.numero_pedido,
                    omie_codigo: pedido.omie_codigo_pedido,
                    status: pedido.status,
                    total_itens: pedido.total_itens,
                    valor_total: pedido.valor_total
                },
                itens_locais: itensLocais.map(i => ({
                    produto_id: i.produto_id,
                    produto_codigo: i.produto_codigo,
                    produto_nome: i.produto_nome,
                    quantidade: i.quantidade,
                    valor_unitario: i.valor_unitario
                }))
            });
        }

        const pedidoOmie = omieResult.pedido_venda_produto || omieResult;
        const cabecalho = pedidoOmie.cabecalho || {};
        const det = pedidoOmie.det || [];
        const infAdic = pedidoOmie.informacoes_adicionais || {};

        // Extrair itens do Omie
        const itensOmie = det.map(d => ({
            codigo_item_integracao: d.ide?.codigo_item_integracao,
            codigo_produto: d.produto?.codigo_produto,
            codigo_produto_integracao: d.produto?.codigo_produto_integracao,
            codigo_interno: d.produto?.codigo,
            descricao: d.produto?.descricao,
            ncm: d.produto?.ncm,
            cfop: d.produto?.cfop,
            quantidade: d.produto?.quantidade,
            valor_unitario: d.produto?.valor_unitario,
            unidade: d.produto?.unidade,
            // Dados fiscais do item
            imposto_icms: d.imposto?.icms,
            imposto_pis: d.imposto?.pis,
            imposto_cofins: d.imposto?.cofins,
        }));

        // Comparar
        const comparacao = itensLocais.map(local => {
            const omieItem = itensOmie.find(o => 
                o.codigo_item_integracao === local.id || 
                o.codigo_produto_integracao === local.produto_id
            );
            return {
                local: {
                    id: local.id,
                    produto_id: local.produto_id,
                    produto_codigo: local.produto_codigo,
                    produto_nome: local.produto_nome,
                    quantidade: local.quantidade,
                    valor_unitario: local.valor_unitario
                },
                omie: omieItem || 'NÃO ENCONTRADO NO OMIE',
                match: !!omieItem
            };
        });

        return Response.json({
            sucesso: true,
            pedido_local: {
                numero: pedido.numero_pedido,
                omie_codigo: pedido.omie_codigo_pedido,
                status: pedido.status,
                cliente: pedido.cliente_nome,
                cenario_fiscal: pedido.cenario_fiscal_nome,
                cenario_fiscal_codigo: pedido.cenario_fiscal_codigo,
                total_itens: pedido.total_itens,
                valor_total: pedido.valor_total
            },
            pedido_omie: {
                numero_pedido: cabecalho.numero_pedido,
                codigo_pedido: cabecalho.codigo_pedido,
                etapa: cabecalho.etapa,
                codigo_cliente: cabecalho.codigo_cliente,
                codigo_cenario: cabecalho.codigo_cenario_impostos || infAdic.codigo_cenario_impostos,
                qtd_itens: det.length
            },
            itens_locais: itensLocais.length,
            itens_omie: itensOmie.length,
            itens_omie_detalhe: itensOmie,
            comparacao
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});