import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      // Tratamento de status HTTP ANTES de res.json() — num 5xx/429 o corpo não costuma ser JSON.
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 425) {
          const _cbId = '6a1e06a9aa62ceab7b3b6d97';
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p: any = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

// ✅ ITEM 7
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

        const etapaReal = String(pedidoOmieAtual?.cabecalho?.etapa || '10').trim();
        const etapa = etapaReal || "10";

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