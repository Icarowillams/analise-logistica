import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

function formatDateOmie(dateStr) {
    if (!dateStr) {
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        return `${d}/${m}/${y}`;
    }
    if (dateStr.includes('-')) {
        const [y, m, d] = dateStr.split('T')[0].split('-');
        return `${d}/${m}/${y}`;
    }
    return dateStr;
}

function gerarParcelas(plano, valorTotal, dataBase) {
    const numParcelas = plano?.numero_parcelas || 1;
    const diasPrimeira = plano?.dias_primeira_parcela || 30;
    const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;
    
    const parcelas = [];
    for (let i = 0; i < numParcelas; i++) {
        const diasOffset = diasPrimeira + (i * 30);
        const dataVenc = new Date(dataBase);
        dataVenc.setDate(dataVenc.getDate() + diasOffset);
        
        const d = String(dataVenc.getDate()).padStart(2, '0');
        const m = String(dataVenc.getMonth() + 1).padStart(2, '0');
        const y = dataVenc.getFullYear();

        let valor = valorParcela;
        if (i === numParcelas - 1) {
            const totalAnterior = parcelas.reduce((s, p) => s + p.valor, 0);
            valor = Math.round((valorTotal - totalAnterior) * 100) / 100;
        }

        parcelas.push({
            numero_parcela: i + 1,
            data_vencimento: `${d}/${m}/${y}`,
            percentual: Math.round((100 / numParcelas) * 100) / 100,
            valor
        });
    }
    return parcelas;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { pedido_id } = await req.json();
        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        // Buscar pedido atualizado
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
            return Response.json({ error: 'Pedido não está no Omie, não é possível alterar' }, { status: 400 });
        }

        // Buscar itens do pedido
        const allItems = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });
        if (allItems.length === 0) {
            return Response.json({ error: 'Pedido sem itens' }, { status: 400 });
        }

        // Buscar plano de pagamento
        let plano = null;
        if (pedido.plano_pagamento_id) {
            plano = await base44.asServiceRole.entities.PlanoPagamento.get(pedido.plano_pagamento_id);
        }

        // Buscar produtos
        const produtoIds = [...new Set(allItems.map(i => i.produto_id))];
        const produtosMap = {};
        for (const pid of produtoIds) {
            const prod = await base44.asServiceRole.entities.Produto.get(pid);
            if (prod) produtosMap[pid] = prod;
        }

        // Buscar unidades de medida
        const unidades = await base44.asServiceRole.entities.UnidadeMedida.list();
        const unidadesMap = {};
        unidades.forEach(u => { unidadesMap[u.id] = u; });

        const dataBase = new Date();
        const dataPrevisao = pedido.data_previsao_entrega
            ? formatDateOmie(pedido.data_previsao_entrega)
            : formatDateOmie(null);

        // Montar itens no formato Omie
        const det = allItems.map((item) => {
            const prod = produtosMap[item.produto_id] || {};
            const unidade = prod.unidade_medida_id ? unidadesMap[prod.unidade_medida_id] : null;
            const unidadeStr = unidade?.nome || 'UN';

            return {
                ide: {
                    codigo_item_integracao: item.id
                },
                inf_adic: {
                    peso_bruto: (prod.peso || 0) * item.quantidade,
                    peso_liquido: (prod.peso || 0) * item.quantidade
                },
                produto: {
                    codigo_produto_integracao: item.produto_id,
                    codigo: prod.codigo || '',
                    descricao: item.produto_nome || prod.nome || '',
                    ncm: prod.ncm || '',
                    quantidade: item.quantidade,
                    valor_unitario: item.valor_unitario,
                    tipo_desconto: "V",
                    valor_desconto: 0,
                    unidade: unidadeStr
                }
            };
        });

        // Montar parcelas
        const parcelas = gerarParcelas(plano, pedido.valor_total || 0, dataBase);

        // Determinar etapa atual
        let etapa = "10";
        if (pedido.status === 'liberado') etapa = "50";

        // Montar payload para AlterarPedidoVenda
        const pedidoOmie = {
            cabecalho: {
                codigo_pedido: pedido.omie_codigo_pedido,
                codigo_pedido_integracao: pedido.id,
                codigo_cliente_integracao: pedido.cliente_id,
                data_previsao: dataPrevisao,
                etapa: etapa,
                codigo_parcela: "999",
                quantidade_itens: allItems.length
            },
            det,
            frete: {
                modalidade: "9"
            },
            informacoes_adicionais: {
                codigo_categoria: "1.01.03",
                consumidor_final: "S",
                enviar_email: "N",
                ...(pedido.numero_pedido_compra ? { numero_pedido_cliente: pedido.numero_pedido_compra } : {}),
                ...(pedido.dados_adicionais_nf ? { dados_adicionais_nf: pedido.dados_adicionais_nf } : {})
            }
        };

        if (parcelas.length > 0) {
            pedidoOmie.lista_parcelas = {
                parcela: parcelas
            };
        }

        if (pedido.observacoes) {
            pedidoOmie.observacoes = {
                obs_venda: pedido.observacoes
            };
        }

        if (pedido.numero_pedido_compra) {
            pedidoOmie.cabecalho.numero_pedido_compra = pedido.numero_pedido_compra;
        }

        // Buscar conta corrente
        let codigoContaCorrente = null;
        try {
            const ccResponse = await fetch("https://app.omie.com.br/api/v1/geral/contacorrente/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ListarContasCorrentes",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{ pagina: 1, registros_por_pagina: 50 }]
                })
            });
            const ccData = await ccResponse.json();
            if (ccData.ListarContasCorrentes && ccData.ListarContasCorrentes.length > 0) {
                const contaPadrao = ccData.ListarContasCorrentes.find(c => c.cPadrao === "S") || ccData.ListarContasCorrentes[0];
                codigoContaCorrente = contaPadrao.nCodCC;
            }
            if (!ccData.faultstring && ccData.conta_corrente_lista) {
                const contaPadrao2 = ccData.conta_corrente_lista.find(c => c.padrao === "S") || ccData.conta_corrente_lista[0];
                codigoContaCorrente = contaPadrao2.nCodCC || contaPadrao2.codigo;
            }
        } catch (ccErr) {
            console.log('[editarPedidoOmie] Erro ao buscar conta corrente:', ccErr.message);
        }

        if (codigoContaCorrente) {
            pedidoOmie.informacoes_adicionais.codigo_conta_corrente = codigoContaCorrente;
        }

        console.log('[editarPedidoOmie] Alterando pedido Omie:', pedido.omie_codigo_pedido, '- Cliente:', pedido.cliente_nome);
        console.log('[editarPedidoOmie] Payload:', JSON.stringify(pedidoOmie).substring(0, 2000));

        // Chamar AlterarPedidoVenda
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "AlterarPedidoVenda",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [pedidoOmie]
            })
        });

        const resultText = await response.text();
        console.log('[editarPedidoOmie] Resposta Omie:', resultText.substring(0, 1000));

        let resultado;
        try { resultado = JSON.parse(resultText); } catch (e) {
            return Response.json({ sucesso: false, erro: 'Resposta inválida do Omie' });
        }

        if (resultado.faultstring) {
            console.error('[editarPedidoOmie] Erro Omie:', resultado.faultstring);
            await base44.asServiceRole.entities.Pedido.update(pedido_id, {
                omie_erro: resultado.faultstring
            });
            return Response.json({
                sucesso: false,
                erro: resultado.faultstring
            });
        }

        // Sucesso - limpar erro
        await base44.asServiceRole.entities.Pedido.update(pedido_id, {
            omie_erro: null
        });

        console.log('[editarPedidoOmie] Pedido alterado com sucesso no Omie!');

        return Response.json({
            sucesso: true,
            mensagem: resultado.descricao_status || 'Pedido alterado no Omie com sucesso'
        });

    } catch (error) {
        console.error('[editarPedidoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});