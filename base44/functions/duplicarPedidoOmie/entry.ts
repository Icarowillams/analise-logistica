import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  if (res.status === 425) {
    return { faultstring: 'API Omie bloqueada (HTTP 425). Aguarde até 30 minutos.', faultcode: 'BLOQUEIO_425' };
  }
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 4) {
      await sleep(3000 * tentativa);
      return omieCall(call, param, tentativa + 1);
    }
  }
  return data;
}

// Hoje em America/Recife no formato dd/mm/yyyy
function hojeBR() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
}

// Constrói payload IncluirPedido a partir de um pedido_venda_produto consultado
function montarPayloadDuplicado(pedidoOriginal, codigoIntegracaoNovo) {
  const cab = pedidoOriginal.cabecalho || {};
  const infoAdic = pedidoOriginal.informacoes_adicionais || {};
  const det = (pedidoOriginal.det || []).map((d, idx) => {
    const novoIde = { codigo_item_integracao: `${codigoIntegracaoNovo}-${idx + 1}` };
    return {
      ide: novoIde,
      inf_adic: d.inf_adic || {},
      produto: { ...(d.produto || {}) }
    };
  });

  // Cenário fiscal pode estar em diferentes campos dependendo da resposta do Omie:
  //  - cabecalho.codigo_cenario / codigo_cenario_impostos
  //  - informacoes_adicionais.codigo_cenario
  // Replicar TODOS para garantir que bonificação/troca/etc. seja preservada.
  const cenarioFiscal =
    cab.codigo_cenario ||
    cab.codigo_cenario_impostos ||
    infoAdic.codigo_cenario ||
    null;

  const cabecalho = {
    codigo_pedido_integracao: codigoIntegracaoNovo,
    // Cliente — usa o mesmo do original
    ...(cab.codigo_cliente ? { codigo_cliente: cab.codigo_cliente } : {}),
    ...(cab.codigo_cliente_integracao ? { codigo_cliente_integracao: cab.codigo_cliente_integracao } : {}),
    data_previsao: hojeBR(),
    etapa: '10',
    codigo_parcela: cab.codigo_parcela || '999',
    quantidade_itens: det.length,
    ...(cenarioFiscal ? { codigo_cenario: String(cenarioFiscal) } : {})
  };

  const payload = {
    cabecalho,
    det,
    frete: pedidoOriginal.frete || { modalidade: '9' },
    informacoes_adicionais: {
      ...infoAdic,
      // Replica o cenário fiscal aqui também (Omie aceita nos dois lugares)
      ...(cenarioFiscal ? { codigo_cenario: String(cenarioFiscal) } : {}),
      // Limpa campos que não devem vir do pedido antigo
      numero_pedido_cliente: undefined,
    }
  };

  // Replica parcelas se houver
  if (pedidoOriginal.lista_parcelas?.parcela?.length > 0) {
    payload.lista_parcelas = {
      parcela: pedidoOriginal.lista_parcelas.parcela.map((p, i) => ({
        numero_parcela: p.numero_parcela || (i + 1),
        data_vencimento: hojeBR(), // recalcular conforme política seria mais correto, mas Omie aceita
        percentual: p.percentual,
        valor: p.valor
      }))
    };
  }

  // Remove chaves undefined
  Object.keys(payload.informacoes_adicionais).forEach(k => {
    if (payload.informacoes_adicionais[k] === undefined) delete payload.informacoes_adicionais[k];
  });

  return payload;
}

async function duplicarUm(base44, codigo_pedido, codigo_pedido_integracao, userEmail) {
  // 1. Consultar pedido original
  const param = {};
  if (codigo_pedido) param.codigo_pedido = Number(codigo_pedido);
  else if (codigo_pedido_integracao) param.codigo_pedido_integracao = String(codigo_pedido_integracao);
  else return { sucesso: false, erro: 'codigo_pedido obrigatório' };

  const consulta = await omieCall('ConsultarPedido', param);
  if (consulta?.faultstring) return { sucesso: false, erro: `Consulta Omie: ${consulta.faultstring}` };
  const pedidoOriginal = consulta.pedido_venda_produto;
  if (!pedidoOriginal) return { sucesso: false, erro: 'Pedido não encontrado no Omie' };

  // 1.b — Fallback do cenário fiscal: se Omie não devolveu nas chaves esperadas,
  // procura no espelho local (PedidoLiberadoOmie → CenarioFiscalLocal) ou no Pedido local
  // pra garantir que bonificação/troca não vire venda na duplicação.
  let cenarioFallback = null;
  const cabOrig = pedidoOriginal.cabecalho || {};
  const infoAdicOrig = pedidoOriginal.informacoes_adicionais || {};
  if (!cabOrig.codigo_cenario && !cabOrig.codigo_cenario_impostos && !infoAdicOrig.codigo_cenario) {
    try {
      const espelhoOrig = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigo_pedido) });
      const esp = espelhoOrig?.[0];
      if (esp?.pedido_id) {
        const pedLocalOrig = await base44.asServiceRole.entities.Pedido.get(esp.pedido_id).catch(() => null);
        if (pedLocalOrig?.cenario_fiscal_codigo) {
          cenarioFallback = String(pedLocalOrig.cenario_fiscal_codigo);
        }
      }
    } catch { /* ignore */ }
    if (cenarioFallback) {
      pedidoOriginal.cabecalho = { ...cabOrig, codigo_cenario: cenarioFallback };
    }
  }

  // 2. Gerar codigo_pedido_integracao único
  const codigoIntegracaoNovo = `DUP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 3. Montar payload e enviar IncluirPedido
  const payload = montarPayloadDuplicado(pedidoOriginal, codigoIntegracaoNovo);
  const resultado = await omieCall('IncluirPedido', payload);
  if (resultado?.faultstring) {
    return { sucesso: false, erro: resultado.faultstring, origem_codigo: codigo_pedido };
  }

  let novoCodigoPedido = resultado.codigo_pedido || resultado.codigo_pedido_omie || resultado.nCodPed || null;
  let novoNumeroPedido = resultado.numero_pedido || resultado.numero_pedido_omie || null;

  // Fallback: se IncluirPedido não retornou codigo_pedido, consulta pelo codigo_pedido_integracao
  // que acabamos de criar — sem isso, perdemos o vínculo e Liberar Pedido falha.
  if (!novoCodigoPedido) {
    await sleep(800);
    const confer = await omieCall('ConsultarPedido', { codigo_pedido_integracao: codigoIntegracaoNovo });
    if (confer?.pedido_venda_produto?.cabecalho) {
      novoCodigoPedido = confer.pedido_venda_produto.cabecalho.codigo_pedido || novoCodigoPedido;
      novoNumeroPedido = confer.pedido_venda_produto.cabecalho.numero_pedido || novoNumeroPedido;
    }
  }

  if (!novoCodigoPedido) {
    return { sucesso: false, erro: 'Pedido criado no Omie mas não retornou codigo_pedido — verifique manualmente', origem_codigo: codigo_pedido, codigo_pedido_integracao: codigoIntegracaoNovo };
  }

  // 4. Criar registro local na entidade Pedido (status pendente) para aparecer no Gerenciar Pedidos
  let pedidoLocalId = null;
  try {
    const cab = pedidoOriginal.cabecalho || {};

    // Tenta primeiro pegar do espelho PedidoLiberadoOmie (já tem cliente_id resolvido)
    let clienteLocal = null;
    let vendedorLocal = null;
    try {
      const espelho = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigo_pedido) });
      if (espelho?.length) {
        const esp = espelho[0];
        if (esp.cliente_id) {
          clienteLocal = await base44.asServiceRole.entities.Cliente.get(esp.cliente_id).catch(() => null);
        }
        if (esp.vendedor_id) {
          vendedorLocal = await base44.asServiceRole.entities.Vendedor.get(esp.vendedor_id).catch(() => null);
        }
      }
    } catch { /* ignore */ }

    // Fallback: resolver pelo codigo_omie do cliente
    if (!clienteLocal && cab.codigo_cliente) {
      const found = await base44.asServiceRole.entities.Cliente.filter({ codigo_omie: String(cab.codigo_cliente) });
      if (found?.length) clienteLocal = found[0];
    }
    if (!clienteLocal && cab.codigo_cliente_integracao) {
      const found = await base44.asServiceRole.entities.Cliente.filter({ codigo_integracao: String(cab.codigo_cliente_integracao) });
      if (found?.length) clienteLocal = found[0];
    }

    const totalItens = (pedidoOriginal.det || []).length;
    const valorTotal = (pedidoOriginal.det || []).reduce((s, d) => s + (Number(d.produto?.valor_total) || 0), 0);

    // Determina o tipo do pedido a partir do cenário fiscal (bonificação/troca/devolução/venda)
    const cenarioCod = pedidoOriginal.cabecalho?.codigo_cenario
      || pedidoOriginal.cabecalho?.codigo_cenario_impostos
      || pedidoOriginal.informacoes_adicionais?.codigo_cenario
      || null;

    let tipoPedido = 'venda';
    let cenarioNome = '';
    if (cenarioCod) {
      try {
        const cenarios = await base44.asServiceRole.entities.CenarioFiscalLocal.filter({ cenario_omie_codigo: String(cenarioCod) });
        const cen = cenarios?.[0];
        if (cen) {
          cenarioNome = cen.nome || '';
          if (['bonificacao', 'troca', 'devolucao'].includes(cen.tipo_operacao)) {
            tipoPedido = cen.tipo_operacao;
          }
        }
      } catch { /* ignore */ }
    }

    const novoPedidoLocal = await base44.asServiceRole.entities.Pedido.create({
      tipo: tipoPedido,
      origem: 'omie',
      cenario_fiscal_codigo: cenarioCod ? Number(cenarioCod) : undefined,
      cenario_fiscal_nome: cenarioNome,
      numero_pedido: novoNumeroPedido ? String(novoNumeroPedido) : '',
      status: 'pendente',
      etapa: 'comercial',
      cliente_id: clienteLocal?.id || '',
      cliente_codigo: clienteLocal?.codigo_interno || clienteLocal?.codigo_omie || '',
      cliente_nome: clienteLocal?.razao_social || '',
      cliente_nome_fantasia: clienteLocal?.nome_fantasia || '',
      cliente_cpf_cnpj: clienteLocal?.cnpj_cpf || '',
      cliente_endereco: clienteLocal?.endereco || '',
      cliente_numero: clienteLocal?.numero || '',
      cliente_bairro: clienteLocal?.bairro || '',
      cliente_cidade: clienteLocal?.cidade || '',
      cliente_estado: clienteLocal?.estado || '',
      cliente_cep: clienteLocal?.cep || '',
      vendedor_id: vendedorLocal?.id || clienteLocal?.vendedor_id || '',
      vendedor_nome: vendedorLocal?.nome || '',
      modelo_nota: '55',
      total_itens: totalItens,
      valor_total: valorTotal,
      omie_enviado: true,
      omie_codigo_pedido: String(novoCodigoPedido || ''),
      data_envio: new Date().toISOString(),
      pedido_origem_numero: cab.numero_pedido || '',
      observacoes: `Pedido duplicado a partir do pedido Omie ${cab.numero_pedido || codigo_pedido}`
    });
    pedidoLocalId = novoPedidoLocal?.id;
  } catch (e) {
    console.error('[duplicarPedidoOmie] Falha ao criar Pedido local:', e.message);
  }

  // 4.b — Cria/atualiza espelho PedidoLiberadoOmie pra aparecer IMEDIATAMENTE em
  // Montagem de Carga / Operação Completa sem precisar esperar webhook.
  try {
    const cab = pedidoOriginal.cabecalho || {};
    const det = pedidoOriginal.det || [];
    const cenarioCod = cab.codigo_cenario || cab.codigo_cenario_impostos || pedidoOriginal.informacoes_adicionais?.codigo_cenario || null;

    let tipoOperacao = 'venda';
    let cenarioNome = '';
    if (cenarioCod) {
      try {
        const cenarios = await base44.asServiceRole.entities.CenarioFiscalLocal.filter({ cenario_omie_codigo: String(cenarioCod) });
        const cen = cenarios?.[0];
        if (cen) {
          cenarioNome = cen.nome || '';
          if (['bonificacao', 'troca', 'devolucao', 'remessa'].includes(cen.tipo_operacao)) {
            tipoOperacao = cen.tipo_operacao;
          }
        }
      } catch { /* ignore */ }
    }

    // Resolve cliente do espelho original (mais barato que refazer lookup)
    let clienteIdEsp = '';
    try {
      const espelhoOrig2 = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigo_pedido) });
      if (espelhoOrig2?.[0]?.cliente_id) clienteIdEsp = espelhoOrig2[0].cliente_id;
    } catch { /* ignore */ }

    const produtosEsp = det.map(d => ({
      codigo_produto: String(d.produto?.codigo_produto || ''),
      codigo_produto_integracao: String(d.produto?.codigo_produto_integracao || ''),
      descricao: d.produto?.descricao || '',
      quantidade: Number(d.produto?.quantidade) || 0,
      valor_unitario: Number(d.produto?.valor_unitario) || 0,
      valor_total: Number(d.produto?.valor_total) || 0,
      unidade: d.produto?.unidade || ''
    }));

    await base44.asServiceRole.entities.PedidoLiberadoOmie.create({
      codigo_pedido: String(novoCodigoPedido),
      codigo_pedido_integracao: codigoIntegracaoNovo,
      numero_pedido: novoNumeroPedido ? String(novoNumeroPedido) : '',
      etapa: '10',
      codigo_cliente: String(cab.codigo_cliente || ''),
      codigo_cliente_integracao: String(cab.codigo_cliente_integracao || ''),
      cliente_id: clienteIdEsp,
      tipo_operacao: tipoOperacao,
      cenario_fiscal_codigo: cenarioCod ? Number(cenarioCod) : undefined,
      cenario_fiscal_nome: cenarioNome,
      pedido_id: pedidoLocalId || '',
      quantidade_itens: produtosEsp.length,
      valor_total_pedido: produtosEsp.reduce((s, p) => s + (p.valor_total || 0), 0),
      produtos: produtosEsp,
      sincronizado_em: new Date().toISOString(),
      origem_sync: 'webhook'
    });
  } catch (e) {
    console.error('[duplicarPedidoOmie] Falha ao espelhar PedidoLiberadoOmie:', e.message);
  }

  // 5. Log gerencial
  try {
    await base44.asServiceRole.functions.invoke('registrarLogGerencial', {
      tipo_acao: 'criacao',
      entidade_tipo: 'Pedido',
      entidade_id: String(pedidoLocalId || novoCodigoPedido || ''),
      entidade_descricao: `Pedido duplicado ${novoNumeroPedido || novoCodigoPedido} (origem: ${pedidoOriginal.cabecalho?.numero_pedido || codigo_pedido})`,
      usuario_email: userEmail,
      descricao: `Duplicou pedido ${pedidoOriginal.cabecalho?.numero_pedido || codigo_pedido} → novo pedido ${novoNumeroPedido || novoCodigoPedido}`,
      origem: 'backend'
    });
  } catch { /* ignore */ }

  return {
    sucesso: true,
    origem_codigo: codigo_pedido,
    origem_numero: pedidoOriginal.cabecalho?.numero_pedido,
    novo_codigo_pedido: novoCodigoPedido,
    novo_numero_pedido: novoNumeroPedido,
    pedido_local_id: pedidoLocalId,
    codigo_pedido_integracao: codigoIntegracaoNovo
  };
}

// Duplica pedido(s) Omie. Aceita { codigo_pedido } ou { pedidos: [{codigo_pedido, codigo_pedido_integracao}] }
Deno.serve(async (req) => {
  try {
    if (!APP_KEY || !APP_SECRET) {
      return Response.json({ sucesso: false, erro: 'Credenciais Omie não configuradas' }, { status: 500 });
    }
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Verifica permissão de digitar pedido de venda
    if (user.role !== 'admin') {
      const allVendedores = await base44.asServiceRole.entities.Vendedor.list();
      const vendedor = allVendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
      if (!vendedor) return Response.json({ error: 'Funcionário não encontrado' }, { status: 403 });
      const permissoes = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedor.id });
      const perm = permissoes[0];
      if (!perm?.permissoes_pedidos?.digitar_pedido_venda) {
        return Response.json({ error: 'Sem permissão para digitar pedidos' }, { status: 403 });
      }
    }

    const body = await req.json().catch(() => ({}));
    let listaEntrada = [];
    if (Array.isArray(body.pedidos) && body.pedidos.length > 0) {
      listaEntrada = body.pedidos;
    } else if (body.codigo_pedido || body.codigo_pedido_integracao) {
      listaEntrada = [{ codigo_pedido: body.codigo_pedido, codigo_pedido_integracao: body.codigo_pedido_integracao }];
    } else {
      return Response.json({ sucesso: false, erro: 'Informe codigo_pedido ou pedidos[]' }, { status: 400 });
    }

    const resultados = [];
    for (const item of listaEntrada) {
      const r = await duplicarUm(base44, item.codigo_pedido, item.codigo_pedido_integracao, user.email);
      resultados.push(r);
      // pequeno espaçamento pra não estourar cota
      await sleep(400);
    }

    const sucesso = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso).length;

    return Response.json({
      sucesso: erros === 0,
      total: resultados.length,
      sucessos: sucesso,
      erros,
      resultados
    });
  } catch (error) {
    console.error('[duplicarPedidoOmie] Erro:', error.message);
    return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
  }
});