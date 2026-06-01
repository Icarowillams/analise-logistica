import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  return null;
}
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

async function omieCall(base44, endpoint, param, options = {}) {
  const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
  const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
  const cacheKey = `${endpoint}_${JSON.stringify(param)}`;
  const isReadOnly = /^(Listar|Consultar|Pesquisar|Buscar)/.test(endpoint);
  if (isReadOnly) {
    const cached = getFromMemoryCache(cacheKey);
    if (cached) return cached;
  }
  
  const body = {
    call: endpoint,
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param]
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
  
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://app.omie.com.br/api/v1/geral/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      
      const data = await res.json();
      
      if (!options.skipLog) {
        try {
          await base44.entities.create('LogIntegracaoOmie', {
            endpoint,
            payload_envio: JSON.stringify(param).slice(0, 2000),
            payload_resposta: JSON.stringify(data).slice(0, 2000),
            sucesso: !data.faultcode,
            erro: data.faultstring || null,
            created_date: new Date().toISOString()
          });
        } catch(logErr) { /* silent fail */ }
      }
      if (isReadOnly) setMemoryCache(cacheKey, data);
      
      return data;
    } catch(err) {
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

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

        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
            return Response.json({ error: 'Pedido não está no Omie, não é possível alterar' }, { status: 400 });
        }

        // Buscar itens ATUAIS do pedido no Base44
        const newItems = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });
        if (newItems.length === 0) {
            return Response.json({ error: 'Pedido sem itens' }, { status: 400 });
        }

        // ====================================================================
        // PASSO 1: Consultar pedido no Omie para obter os itens ATUAIS do Omie
        // Isso é necessário para reusar os codigo_item_integracao existentes
        // e evitar que o Omie DUPLIQUE itens ao receber IDs novos
        // ====================================================================
        console.log(`[editarPedidoOmie] Consultando pedido ${pedido.omie_codigo_pedido} no Omie...`);
        
        const consultaResult = await omieCall(base44, "ConsultarPedido", { codigo_pedido: Number(pedido.omie_codigo_pedido) });
        
        if (consultaResult.faultstring) {
            console.error('[editarPedidoOmie] Erro ao consultar pedido no Omie:', consultaResult.faultstring);
            return Response.json({ sucesso: false, erro: `Erro ao consultar pedido no Omie: ${consultaResult.faultstring}` });
        }

        const pedidoOmieAtual = consultaResult.pedido_venda_produto || consultaResult;
        if (JSON.stringify(pedidoOmieAtual).toLowerCase().includes('cancelado') || JSON.stringify(pedidoOmieAtual).toLowerCase().includes('cancelada')) {
            return Response.json({ sucesso: false, erro: 'Pedido cancelado: não é permitido editar ou ajustar.' });
        }
        const itensOmieAtuais = pedidoOmieAtual.det || [];
        
        // Criar um mapa de itens do Omie por codigo_produto_integracao (= produto_id no Base44)
        // para podermos reusar o codigo_item_integracao existente
        const omieItemsByProduto = {};
        for (const itemOmie of itensOmieAtuais) {
            const prodInteg = (itemOmie.produto || {}).codigo_produto_integracao;
            if (prodInteg) {
                if (!omieItemsByProduto[prodInteg]) {
                    omieItemsByProduto[prodInteg] = [];
                }
                omieItemsByProduto[prodInteg].push((itemOmie.ide || {}).codigo_item_integracao);
            }
        }
        
        console.log(`[editarPedidoOmie] Pedido tem ${itensOmieAtuais.length} itens no Omie, ${newItems.length} itens novos no Base44`);

        // ====================================================================
        // PASSO 2: Buscar dados auxiliares
        // ====================================================================
        let plano = null;
        if (pedido.plano_pagamento_id) {
            plano = await base44.asServiceRole.entities.PlanoPagamento.get(pedido.plano_pagamento_id);
        }

        const produtoIds = [...new Set(newItems.map(i => i.produto_id))];
        const produtosMap = {};
        for (const pid of produtoIds) {
            const prod = await base44.asServiceRole.entities.Produto.get(pid);
            if (prod) produtosMap[pid] = prod;
        }

        const unidades = await base44.asServiceRole.entities.UnidadeMedida.list();
        const unidadesMap = {};
        unidades.forEach(u => { unidadesMap[u.id] = u; });

        // ====================================================================
        // PASSO 3: Resolver cliente no Omie
        // ====================================================================
        const OMIE_CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/";
        let codigoClienteIntegracao = pedido.cliente_codigo || pedido.cliente_id;

        const tentarConsultarCliente = async (codIntegracao) => {
            return await omieCall(base44, "ConsultarCliente", { codigo_cliente_integracao: codIntegracao });
        };

        const isErroBloqueio = (fault) => {
            if (!fault) return false;
            const f = fault.toLowerCase();
            return f.includes('bloqueada') || f.includes('too many') || f.includes('try again') || f.includes('tente novamente');
        };

        let clienteEncontradoOmie = false;

        const consultaCodigo = await tentarConsultarCliente(codigoClienteIntegracao);
        if (!consultaCodigo.faultstring) {
            clienteEncontradoOmie = true;
        } else if (isErroBloqueio(consultaCodigo.faultstring)) {
            return Response.json({ sucesso: false, erro: 'API Omie temporariamente bloqueada.' });
        } else {
            const idBase44 = pedido.cliente_id;
            if (idBase44 && idBase44 !== codigoClienteIntegracao) {
                const consultaId = await tentarConsultarCliente(idBase44);
                if (!consultaId.faultstring) {
                    codigoClienteIntegracao = idBase44;
                    clienteEncontradoOmie = true;
                } else if (isErroBloqueio(consultaId.faultstring)) {
                    return Response.json({ sucesso: false, erro: 'API Omie temporariamente bloqueada.' });
                }
            }
        }

        if (!clienteEncontradoOmie && pedido.cliente_cpf_cnpj) {
            const cpfCnpj = (pedido.cliente_cpf_cnpj || '').replace(/[^\d]/g, '');
            if (cpfCnpj) {
                try {
                    const dataCpf = await omieCall(base44, "ListarClientes", { pagina: 1, registros_por_pagina: 5, clientesFiltro: { cnpj_cpf: cpfCnpj } });
                    if (!dataCpf.faultstring && dataCpf.clientes_cadastro?.length > 0) {
                        codigoClienteIntegracao = dataCpf.clientes_cadastro[0].codigo_cliente_integracao;
                        clienteEncontradoOmie = true;
                    }
                } catch (cpfErr) {
                    console.log(`[editarPedidoOmie] Erro busca CPF/CNPJ: ${cpfErr.message}`);
                }
            }
        }

        if (!clienteEncontradoOmie) {
            return Response.json({ sucesso: false, erro: 'Cliente não encontrado no Omie.' });
        }

        // ====================================================================
        // PASSO 4: Montar itens reusando os codigo_item_integracao do Omie
        // Isso EVITA duplicação de itens
        // ====================================================================
        const det = [];
        const usedOmieIds = new Set();

        for (const item of newItems) {
            const prod = produtosMap[item.produto_id] || {};
            const unidade = prod.unidade_medida_id ? unidadesMap[prod.unidade_medida_id] : null;
            const unidadeStr = unidade?.nome || 'UN';

            // Tentar reusar um codigo_item_integracao existente no Omie para este produto
            let codigoItemIntegracao = item.id; // fallback: usar o ID do Base44 (item novo)
            
            const omieIdsForProduct = omieItemsByProduto[item.produto_id] || [];
            for (const omieId of omieIdsForProduct) {
                if (!usedOmieIds.has(omieId)) {
                    codigoItemIntegracao = omieId;
                    usedOmieIds.add(omieId);
                    break;
                }
            }

            det.push({
                ide: {
                    codigo_item_integracao: codigoItemIntegracao
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
            });
        }

        const reusedCount = usedOmieIds.size;
        const newCount = newItems.length - reusedCount;
        console.log(`[editarPedidoOmie] Reusando ${reusedCount} IDs do Omie, ${newCount} itens novos`);

        // ====================================================================
        // PASSO 5: Montar e enviar payload
        // ====================================================================
        const dataBase = new Date();
        const dataPrevisao = pedido.data_previsao_entrega
            ? formatDateOmie(pedido.data_previsao_entrega)
            : formatDateOmie(null);

        const parcelas = gerarParcelas(plano, pedido.valor_total || 0, dataBase);

        let etapa = "10";
        if (pedido.status === 'liberado') etapa = "50";

        const pedidoOmie = {
            cabecalho: {
                codigo_pedido: pedido.omie_codigo_pedido,
                codigo_pedido_integracao: pedido.id,
                codigo_cliente_integracao: codigoClienteIntegracao,
                data_previsao: dataPrevisao,
                etapa: etapa,
                codigo_parcela: "999",
                quantidade_itens: newItems.length
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
            pedidoOmie.lista_parcelas = { parcela: parcelas };
        }

        // Buscar conta corrente
        let codigoContaCorrente = null;
        try {
            const ccData = await omieCall(base44, "ListarContasCorrentes", { pagina: 1, registros_por_pagina: 50 });
            if (ccData.ListarContasCorrentes?.length > 0) {
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

        const resultado = await omieCall(base44, "AlterarPedidoVenda", pedidoOmie);
        console.log('[editarPedidoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 1000));

        if (resultado.faultstring) {
            console.error('[editarPedidoOmie] Erro Omie:', resultado.faultstring);
            await base44.asServiceRole.entities.Pedido.update(pedido_id, {
                omie_erro: resultado.faultstring
            });
            return Response.json({ sucesso: false, erro: resultado.faultstring });
        }

        await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: null });

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