import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

// Formata data DD/MM/YYYY
function formatDateOmie(dateStr) {
    if (!dateStr) {
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        return `${d}/${m}/${y}`;
    }
    // Aceita ISO (YYYY-MM-DD) ou DD/MM/YYYY
    if (dateStr.includes('-')) {
        const [y, m, d] = dateStr.split('T')[0].split('-');
        return `${d}/${m}/${y}`;
    }
    return dateStr;
}

// Gera parcelas baseado no plano de pagamento
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
        // Ajustar última parcela para bater o total
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
    let base44 = null;
    let pedido_id = null;
    
    try {
        base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Apenas admins podem enviar pedidos ao Omie
        if (user.role !== 'admin') {
            return Response.json({ error: 'Apenas administradores podem enviar pedidos ao Omie' }, { status: 403 });
        }

        const body = await req.json();
        pedido_id = body.pedido_id;
        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        // Buscar pedido
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        if (pedido.status !== 'enviado' && pedido.status !== 'liberado') {
            return Response.json({ error: 'Apenas pedidos enviados ou liberados podem ser enviados ao Omie' }, { status: 400 });
        }

        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
            return Response.json({ error: 'Este pedido já foi enviado ao Omie', codigo_omie: pedido.omie_codigo_pedido }, { status: 400 });
        }

        // Não gerar venda no Omie para Troca
        if (pedido.tipo === 'troca') {
            return Response.json({
                sucesso: true,
                codigo_pedido_omie: null,
                numero_pedido_omie: null,
                mensagem: 'Pedido de Troca não gera venda no Omie'
            });
        }

        // Buscar itens do pedido
        const allItems = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });
        if (allItems.length === 0) {
            return Response.json({ error: 'Pedido sem itens' }, { status: 400 });
        }

        // Buscar plano de pagamento (se existir)
        let plano = null;
        if (pedido.plano_pagamento_id) {
            plano = await base44.asServiceRole.entities.PlanoPagamento.get(pedido.plano_pagamento_id);
        }

        // Buscar produtos para dados completos (NCM, peso, etc)
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

        // Data base para cálculo das parcelas
        const dataBase = new Date();

        // Data de previsão de entrega
        const dataPrevisao = pedido.data_previsao_entrega 
            ? formatDateOmie(pedido.data_previsao_entrega) 
            : formatDateOmie(null);

        // Montar itens no formato Omie
        const det = allItems.map((item, index) => {
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

        // Definir etapa
        // 10 = Pedido de Venda, 20 = Separar, 50 = Faturar
        const etapa = "10";

        // Montar payload do pedido
        const pedidoOmie = {
            cabecalho: {
                codigo_pedido_integracao: pedido.id,
                codigo_cliente_integracao: pedido.cliente_id,
                data_previsao: dataPrevisao,
                etapa: etapa,
                codigo_parcela: "999", // 999 = conforme parcelas informadas
                quantidade_itens: allItems.length,
                ...(pedido.cenario_fiscal_codigo ? { codigo_cenario_impostos: String(pedido.cenario_fiscal_codigo) } : {})
            },
            det,
            frete: {
                modalidade: "9" // 9 = sem frete
            },
            informacoes_adicionais: {
                codigo_categoria: "1.01.03",
                consumidor_final: "S",
                enviar_email: "N"
            }
        };

        // Adicionar parcelas se houver
        if (parcelas.length > 0) {
            pedidoOmie.lista_parcelas = {
                parcela: parcelas
            };
        }

        // Adicionar observações se existir
        if (pedido.observacoes) {
            pedidoOmie.observacoes = {
                obs_venda: pedido.observacoes
            };
        }

        // Adicionar número do pedido de compra se existir
        if (pedido.numero_pedido_compra) {
            pedidoOmie.cabecalho.numero_pedido_compra = pedido.numero_pedido_compra;
        }

        // Buscar conta corrente no Omie
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
                // Pegar a primeira conta corrente ativa
                const contaPadrao = ccData.ListarContasCorrentes.find(c => c.cPadrao === "S") || ccData.ListarContasCorrentes[0];
                codigoContaCorrente = contaPadrao.nCodCC;
                console.log('[enviarPedidoOmie] Conta corrente encontrada:', codigoContaCorrente, contaPadrao.cDescricao);
            }

            if (!ccData.faultstring && ccData.conta_corrente_lista) {
                const contaPadrao2 = ccData.conta_corrente_lista.find(c => c.padrao === "S") || ccData.conta_corrente_lista[0];
                codigoContaCorrente = contaPadrao2.nCodCC || contaPadrao2.codigo;
            }
        } catch (ccErr) {
            console.log('[enviarPedidoOmie] Erro ao buscar conta corrente:', ccErr.message);
        }

        if (codigoContaCorrente) {
            pedidoOmie.informacoes_adicionais.codigo_conta_corrente = codigoContaCorrente;
        }

        console.log('[enviarPedidoOmie] Enviando pedido:', pedido.id, '- Cliente:', pedido.cliente_nome);
        console.log('[enviarPedidoOmie] Payload:', JSON.stringify(pedidoOmie).substring(0, 2000));

        // Enviar para Omie
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "IncluirPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [pedidoOmie]
            })
        });

        const resultado = await response.json();
        console.log('[enviarPedidoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 1000));

        if (resultado.faultstring) {
            // Se já existe, tentar pegar o código
            const jaExiste = resultado.faultstring.includes("já cadastrado") || resultado.faultstring.includes("já existe");
            
            console.error('[enviarPedidoOmie] Erro Omie:', resultado.faultstring);
            
            // Atualizar pedido com erro e reverter para pendente
            await base44.asServiceRole.entities.Pedido.update(pedido_id, {
                status: 'pendente',
                numero_pedido: null,
                data_envio: null,
                omie_erro: resultado.faultstring,
                omie_enviado: false
            });

            return Response.json({
                sucesso: false,
                erro: resultado.faultstring,
                ja_existe: jaExiste
            });
        }

        const codigoOmie = resultado.codigo_pedido || resultado.codigo_pedido_omie || null;
        const numeroPedidoOmie = resultado.numero_pedido || resultado.numero_pedido_omie || null;

        // Atualizar pedido no Base44 com dados do Omie (incluindo número do pedido Omie)
        const updateData = {
            omie_codigo_pedido: codigoOmie,
            omie_enviado: true,
            omie_erro: null
        };
        if (numeroPedidoOmie) {
            updateData.numero_pedido = String(numeroPedidoOmie);
        }
        await base44.asServiceRole.entities.Pedido.update(pedido_id, updateData);

        console.log('[enviarPedidoOmie] Pedido enviado com sucesso! Código Omie:', codigoOmie);

        return Response.json({
            sucesso: true,
            codigo_pedido_omie: codigoOmie,
            numero_pedido_omie: numeroPedidoOmie,
            mensagem: resultado.descricao_status || 'Pedido enviado ao Omie com sucesso'
        });

    } catch (error) {
        console.error('[enviarPedidoOmie] Erro geral:', error.message);
        
        // Tentar reverter o pedido para pendente em caso de erro geral
        if (base44 && pedido_id) {
            try {
                await base44.asServiceRole.entities.Pedido.update(pedido_id, {
                    status: 'pendente',
                    numero_pedido: null,
                    data_envio: null,
                    omie_erro: `Erro interno: ${error.message}`,
                    omie_enviado: false
                });
                console.log('[enviarPedidoOmie] Pedido revertido para pendente após erro');
            } catch (recoveryErr) {
                console.error('[enviarPedidoOmie] Erro ao reverter pedido:', recoveryErr.message);
            }
        }
        
        return Response.json({ error: error.message, sucesso: false, erro: error.message }, { status: 500 });
    }
});