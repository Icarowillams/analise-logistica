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

        // Verificar permissão de enviar pedido (admin sempre pode, ou quem tem permissão)
        if (user.role !== 'admin') {
            const vendedores = await base44.asServiceRole.entities.Vendedor.filter({ email: user.email });
            const vendedor = vendedores[0];
            if (vendedor) {
                const permissoes = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedor.id });
                const perm = permissoes[0];
                if (!perm?.permissoes_pedidos?.enviar_pedido) {
                    return Response.json({ error: 'Você não tem permissão para enviar pedidos' }, { status: 403 });
                }
            } else {
                return Response.json({ error: 'Funcionário não encontrado para este usuário' }, { status: 403 });
            }
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

        if (!['pendente', 'enviado', 'liberado'].includes(pedido.status)) {
            return Response.json({ error: 'Pedido com status inválido para envio ao Omie' }, { status: 400 });
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

        // Resolver codigo_cliente_integracao correto no Omie
        // Alguns clientes foram cadastrados com o ID do Base44, outros com o campo 'codigo'
        let codigoClienteIntegracao = pedido.cliente_codigo || pedido.cliente_id;
        
        // Buscar o cliente no Base44 para ter o ID e codigo
        let clienteBase44 = null;
        if (pedido.cliente_id) {
            try {
                clienteBase44 = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id);
            } catch (e) {
                console.log('[enviarPedidoOmie] Não conseguiu buscar cliente:', e.message);
            }
        }

        // Tentar consultar o cliente no Omie pelo codigo_cliente_integracao atual
        // Se não encontrar, tentar com o ID do Base44
        const OMIE_CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/";
        let clienteEncontradoOmie = false;
        
        const tentarConsultarCliente = async (codIntegracao) => {
            const res = await fetch(OMIE_CLIENTES_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ConsultarCliente",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{ codigo_cliente_integracao: codIntegracao }]
                })
            });
            return await res.json();
        };

        // Verificar se o erro é de rate limit/bloqueio (não deve ser interpretado como "não encontrado")
        const isErroBloqueio = (fault) => {
            if (!fault) return false;
            const f = fault.toLowerCase();
            return f.includes('bloqueada') || f.includes('too many') || f.includes('try again') || f.includes('tente novamente');
        };

        // Tentar com o codigo do cliente primeiro
        const consultaCodigo = await tentarConsultarCliente(codigoClienteIntegracao);
        if (!consultaCodigo.faultstring) {
            clienteEncontradoOmie = true;
            console.log(`[enviarPedidoOmie] Cliente encontrado no Omie com codigo_integracao: ${codigoClienteIntegracao}`);
        } else if (isErroBloqueio(consultaCodigo.faultstring)) {
            // API bloqueada — não podemos saber se o cliente existe, abortar com erro claro
            console.error(`[enviarPedidoOmie] API Omie bloqueada: ${consultaCodigo.faultstring}`);
            return Response.json({ sucesso: false, erro: 'API Omie temporariamente bloqueada. Tente novamente em alguns minutos.' });
        } else {
            // Tentar com o ID do Base44
            const idBase44 = pedido.cliente_id;
            if (idBase44 && idBase44 !== codigoClienteIntegracao) {
                const consultaId = await tentarConsultarCliente(idBase44);
                if (!consultaId.faultstring) {
                    codigoClienteIntegracao = idBase44;
                    clienteEncontradoOmie = true;
                    console.log(`[enviarPedidoOmie] Cliente encontrado no Omie com ID Base44: ${idBase44}`);
                } else if (isErroBloqueio(consultaId.faultstring)) {
                    console.error(`[enviarPedidoOmie] API Omie bloqueada: ${consultaId.faultstring}`);
                    return Response.json({ sucesso: false, erro: 'API Omie temporariamente bloqueada. Tente novamente em alguns minutos.' });
                }
            }
            // Tentar também com o campo codigo do cliente (se diferente)
            if (!clienteEncontradoOmie && clienteBase44?.codigo && clienteBase44.codigo !== codigoClienteIntegracao) {
                const consultaCod2 = await tentarConsultarCliente(clienteBase44.codigo);
                if (!consultaCod2.faultstring) {
                    codigoClienteIntegracao = clienteBase44.codigo;
                    clienteEncontradoOmie = true;
                    console.log(`[enviarPedidoOmie] Cliente encontrado no Omie com codigo: ${clienteBase44.codigo}`);
                } else if (isErroBloqueio(consultaCod2.faultstring)) {
                    console.error(`[enviarPedidoOmie] API Omie bloqueada: ${consultaCod2.faultstring}`);
                    return Response.json({ sucesso: false, erro: 'API Omie temporariamente bloqueada. Tente novamente em alguns minutos.' });
                }
            }
        }

        // Fallback final: buscar pelo CPF/CNPJ no Omie
        if (!clienteEncontradoOmie && (clienteBase44?.cpf_cnpj || pedido.cliente_cpf_cnpj)) {
            const cpfCnpj = (clienteBase44?.cpf_cnpj || pedido.cliente_cpf_cnpj || '').replace(/[^\d]/g, '');
            if (cpfCnpj) {
                console.log(`[enviarPedidoOmie] Tentando buscar cliente no Omie pelo CPF/CNPJ: ${cpfCnpj}`);
                try {
                    const resCpf = await fetch(OMIE_CLIENTES_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            call: "ListarClientes",
                            app_key: OMIE_APP_KEY,
                            app_secret: OMIE_APP_SECRET,
                            param: [{ pagina: 1, registros_por_pagina: 5, clientesFiltro: { cnpj_cpf: cpfCnpj } }]
                        })
                    });
                    const dataCpf = await resCpf.json();
                    if (!dataCpf.faultstring && dataCpf.clientes_cadastro && dataCpf.clientes_cadastro.length > 0) {
                        const clienteOmie = dataCpf.clientes_cadastro[0];
                        codigoClienteIntegracao = clienteOmie.codigo_cliente_integracao;
                        clienteEncontradoOmie = true;
                        console.log(`[enviarPedidoOmie] Cliente encontrado no Omie pelo CPF/CNPJ! codigo_integracao: ${codigoClienteIntegracao}`);
                        
                        // Atualizar o codigo_cliente_integracao no Omie para o novo ID/codigo do Base44
                        const novoCodigoIntegracao = clienteBase44?.codigo || pedido.cliente_id;
                        if (novoCodigoIntegracao && novoCodigoIntegracao !== codigoClienteIntegracao) {
                            try {
                                const resAlt = await fetch(OMIE_CLIENTES_URL, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        call: "AlterarCliente",
                                        app_key: OMIE_APP_KEY,
                                        app_secret: OMIE_APP_SECRET,
                                        param: [{
                                            codigo_cliente_omie: clienteOmie.codigo_cliente_omie,
                                            codigo_cliente_integracao: novoCodigoIntegracao,
                                            razao_social: clienteOmie.razao_social,
                                            cnpj_cpf: cpfCnpj
                                        }]
                                    })
                                });
                                const resAltData = await resAlt.json();
                                if (!resAltData.faultstring) {
                                    console.log(`[enviarPedidoOmie] codigo_cliente_integracao atualizado no Omie de "${codigoClienteIntegracao}" para "${novoCodigoIntegracao}"`);
                                    codigoClienteIntegracao = novoCodigoIntegracao;
                                } else {
                                    console.log(`[enviarPedidoOmie] Não atualizou codigo_integracao no Omie: ${resAltData.faultstring}. Usando o antigo.`);
                                }
                            } catch (altErr) {
                                console.log(`[enviarPedidoOmie] Erro ao atualizar codigo_integracao: ${altErr.message}. Usando o antigo.`);
                            }
                        }
                    } else if (isErroBloqueio(dataCpf.faultstring)) {
                        console.error(`[enviarPedidoOmie] API Omie bloqueada na busca por CPF/CNPJ: ${dataCpf.faultstring}`);
                        return Response.json({ sucesso: false, erro: 'API Omie temporariamente bloqueada. Tente novamente em alguns minutos.' });
                    }
                } catch (cpfErr) {
                    console.log(`[enviarPedidoOmie] Erro ao buscar por CPF/CNPJ: ${cpfErr.message}`);
                }
            }
        }

        if (!clienteEncontradoOmie) {
            console.error(`[enviarPedidoOmie] Cliente não encontrado no Omie com nenhum código de integração nem CPF/CNPJ`);
            return Response.json({ sucesso: false, erro: 'Cliente não cadastrado no Omie. Exporte o cliente primeiro.' });
        }

        console.log(`[enviarPedidoOmie] Usando codigo_cliente_integracao: ${codigoClienteIntegracao}`);

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

            const infAdic = {
                peso_bruto: (prod.peso || 0) * item.quantidade,
                peso_liquido: (prod.peso || 0) * item.quantidade
            };
            if (pedido.numero_pedido_compra) {
                infAdic.numero_pedido_compra = pedido.numero_pedido_compra;
            }
            if (pedido.numero_pedido_compra) {
                infAdic.dados_adicionais_item = `Pedido de Compra: ${pedido.numero_pedido_compra}`;
            }

            return {
                ide: {
                    codigo_item_integracao: item.id
                },
                inf_adic: infAdic,
                produto: {
                    codigo_produto_integracao: item.produto_id,
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
                codigo_cliente_integracao: codigoClienteIntegracao,
                data_previsao: dataPrevisao,
                etapa: etapa,
                codigo_parcela: "999", // 999 = conforme parcelas informadas
                quantidade_itens: allItems.length,
                ...(pedido.cenario_fiscal_codigo ? { codigo_cenario_impostos: String(pedido.cenario_fiscal_codigo) } : {}),

            },
            det,
            frete: {
                modalidade: "9" // 9 = sem frete
            },
            informacoes_adicionais: {
                codigo_categoria: "1.01.03",
                consumidor_final: "S",
                enviar_email: "N",
                ...(pedido.numero_pedido_compra ? { numero_pedido_cliente: pedido.numero_pedido_compra } : {}),
                ...(pedido.dados_adicionais_nf ? { dados_adicionais_nf: pedido.dados_adicionais_nf } : {})
            }
        };

        // Adicionar parcelas se houver
        if (parcelas.length > 0) {
            pedidoOmie.lista_parcelas = {
                parcela: parcelas
            };
        }



        // Conta corrente padrão (Banco do Brasil - confirmada no Omie)
        const CONTA_CORRENTE_PADRAO = 11464371392;

        // Buscar conta corrente dinâmica no Omie, com fallback para a padrão
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
            const listaCC = ccData.ListarContasCorrentes || ccData.conta_corrente_lista || [];
            
            if (listaCC.length > 0) {
                const contaPadrao = listaCC.find(c => c.cPadrao === "S" || c.padrao === "S") || listaCC[0];
                codigoContaCorrente = contaPadrao.nCodCC || contaPadrao.codigo || null;
                console.log('[enviarPedidoOmie] Conta corrente encontrada:', codigoContaCorrente);
            }
        } catch (ccErr) {
            console.log('[enviarPedidoOmie] Erro ao buscar conta corrente:', ccErr.message);
        }

        // Garantir que sempre tenha conta corrente (fallback para padrão)
        if (!codigoContaCorrente) {
            codigoContaCorrente = CONTA_CORRENTE_PADRAO;
            console.log('[enviarPedidoOmie] Usando conta corrente padrão (fallback):', codigoContaCorrente);
        }

        pedidoOmie.informacoes_adicionais.codigo_conta_corrente = codigoContaCorrente;

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
            
            // Registrar erro no pedido
            await base44.asServiceRole.entities.Pedido.update(pedido_id, {
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
            updateData.numero_pedido = numeroPedidoOmie;
            // Atualizar dados_adicionais_nf com o número do pedido automaticamente
            const dadosAtuais = pedido.dados_adicionais_nf || '';
            // Remover prefixo antigo se existir
            const semPrefixo = dadosAtuais.replace(/^Pedido Nº: .+?(\s*\|\s*|$)/, '').trim();
            const partes = [`Pedido Nº: ${numeroPedidoOmie}`];
            if (semPrefixo) partes.push(semPrefixo);
            updateData.dados_adicionais_nf = partes.join(' | ');

            // Atualizar dados_adicionais_nf também no Omie para que apareça na DANFE
            try {
                await fetch(OMIE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: "AlterarPedidoVenda",
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{
                            cabecalho: {
                                codigo_pedido: codigoOmie,
                                codigo_pedido_integracao: pedido.id,
                                etapa: etapa
                            },
                            informacoes_adicionais: {
                                dados_adicionais_nf: updateData.dados_adicionais_nf
                            }
                        }]
                    })
                });
                console.log('[enviarPedidoOmie] dados_adicionais_nf atualizado no Omie com Pedido Nº');
            } catch (altErr) {
                console.error('[enviarPedidoOmie] Erro ao atualizar dados_adicionais_nf no Omie:', altErr.message);
            }
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
        
        // Registrar erro no pedido
        if (base44 && pedido_id) {
            try {
                await base44.asServiceRole.entities.Pedido.update(pedido_id, {
                    omie_erro: `Erro interno: ${error.message}`,
                    omie_enviado: false
                });
            } catch (recoveryErr) {
                console.error('[enviarPedidoOmie] Erro ao registrar erro:', recoveryErr.message);
            }
        }
        
        return Response.json({ error: error.message, sucesso: false, erro: error.message }, { status: 500 });
    }
});