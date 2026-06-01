import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

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

function dateOmieToIso(value) {
  if (!value) return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m}-${d}`;
  }
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
}

function firstDefined(...values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim() !== '');
}

async function getCurrentVendedor(base44, user) {
  const vendedores = await base44.asServiceRole.entities.Vendedor.list();
  return vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase()) || null;
}

async function resolverProdutoLocal(base44, produtoOmie) {
  const codigoOmie = String(produtoOmie?.codigo_produto || '').trim();
  const codigoIntegracao = String(produtoOmie?.codigo_produto_integracao || '').trim();
  const buscas = [];

  if (codigoOmie) buscas.push({ codigo_omie: codigoOmie });
  if (codigoIntegracao) buscas.push({ codigo_integracao: codigoIntegracao });
  if (codigoIntegracao) buscas.push({ codigo: codigoIntegracao });

  for (const filtro of buscas) {
    const encontrados = await base44.asServiceRole.entities.Produto.filter(filtro);
    if (encontrados?.[0]) return encontrados[0];
  }

  return null;
}

async function resolverCenarioLocal(base44, cenarioCodigo) {
  if (!cenarioCodigo) return null;
  const encontrados = await base44.asServiceRole.entities.CenarioFiscalLocal.filter({ cenario_omie_codigo: String(cenarioCodigo) });
  return encontrados?.[0] || null;
}

async function resolverPlano(base44, espelhoOriginal, pedidoLocalOriginal) {
  if (pedidoLocalOriginal?.plano_pagamento_id) {
    const plano = await base44.asServiceRole.entities.PlanoPagamento.get(pedidoLocalOriginal.plano_pagamento_id).catch(() => null);
    if (plano) return plano;
  }

  const nomePlano = firstDefined(pedidoLocalOriginal?.plano_pagamento_nome, espelhoOriginal?.plano_pagamento_nome);
  if (nomePlano) {
    const encontrados = await base44.asServiceRole.entities.PlanoPagamento.filter({ nome: String(nomePlano) });
    if (encontrados?.[0]) return encontrados[0];
  }

  const planos = await base44.asServiceRole.entities.PlanoPagamento.list();
  return planos?.[0] || null;
}

async function resolverTabela(base44, clienteLocal, pedidoLocalOriginal) {
  if (pedidoLocalOriginal?.tabela_preco_id) {
    const tabela = await base44.asServiceRole.entities.TabelaPreco.get(pedidoLocalOriginal.tabela_preco_id).catch(() => null);
    if (tabela) return tabela;
  }
  if (clienteLocal?.tabela_id) {
    const tabela = await base44.asServiceRole.entities.TabelaPreco.get(clienteLocal.tabela_id).catch(() => null);
    if (tabela) return tabela;
  }
  return null;
}

async function resolverCliente(base44, pedidoOriginal, espelhoOriginal, pedidoLocalOriginal) {
  if (pedidoLocalOriginal?.cliente_id) {
    const cliente = await base44.asServiceRole.entities.Cliente.get(pedidoLocalOriginal.cliente_id).catch(() => null);
    if (cliente) return cliente;
  }
  if (espelhoOriginal?.cliente_id) {
    const cliente = await base44.asServiceRole.entities.Cliente.get(espelhoOriginal.cliente_id).catch(() => null);
    if (cliente) return cliente;
  }

  const cab = pedidoOriginal.cabecalho || {};
  const codigoOmie = String(cab.codigo_cliente || espelhoOriginal?.codigo_cliente || '').trim();
  const codigoIntegracao = String(cab.codigo_cliente_integracao || espelhoOriginal?.codigo_cliente_integracao || '').trim();

  if (codigoOmie) {
    const encontrados = await base44.asServiceRole.entities.Cliente.filter({ codigo_omie: codigoOmie });
    if (encontrados?.[0]) return encontrados[0];
  }
  if (codigoIntegracao) {
    const encontrados = await base44.asServiceRole.entities.Cliente.filter({ codigo_integracao: codigoIntegracao });
    if (encontrados?.[0]) return encontrados[0];
  }
  return null;
}

async function buscarContextoOriginal(base44, codigoPedido, codigoPedidoIntegracao) {
  let espelhoOriginal = null;
  let pedidoLocalOriginal = null;

  if (codigoPedido) {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) });
    espelhoOriginal = espelhos?.[0] || null;
  }
  if (!espelhoOriginal && codigoPedidoIntegracao) {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido_integracao: String(codigoPedidoIntegracao) });
    espelhoOriginal = espelhos?.[0] || null;
  }

  if (espelhoOriginal?.pedido_id) {
    pedidoLocalOriginal = await base44.asServiceRole.entities.Pedido.get(espelhoOriginal.pedido_id).catch(() => null);
  }
  if (!pedidoLocalOriginal && codigoPedido) {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) });
    pedidoLocalOriginal = pedidos?.[0] || null;
  }
  if (!pedidoLocalOriginal && codigoPedidoIntegracao) {
    pedidoLocalOriginal = await base44.asServiceRole.entities.Pedido.get(String(codigoPedidoIntegracao)).catch(() => null);
  }

  return { espelhoOriginal, pedidoLocalOriginal };
}

async function duplicarUm(base44, entrada, user, vendedorAtual) {
  const codigoPedido = entrada.codigo_pedido;
  const codigoPedidoIntegracao = entrada.codigo_pedido_integracao;
  const param = {};

  if (codigoPedido) param.codigo_pedido = Number(codigoPedido);
  else if (codigoPedidoIntegracao) param.codigo_pedido_integracao = String(codigoPedidoIntegracao);
  else return { sucesso: false, erro: 'codigo_pedido obrigatório' };

  const consulta = await omieCall(base44, 'ConsultarPedido', param);
  if (consulta?.faultstring) return { sucesso: false, erro: `Consulta Omie: ${consulta.faultstring}`, origem_codigo: codigoPedido };

  const pedidoOriginal = consulta.pedido_venda_produto || consulta;
  const cab = pedidoOriginal.cabecalho || {};
  const info = pedidoOriginal.informacoes_adicionais || {};
  const det = pedidoOriginal.det || [];
  if (det.length === 0) return { sucesso: false, erro: 'Pedido original sem itens para duplicar', origem_codigo: codigoPedido };

  const { espelhoOriginal, pedidoLocalOriginal } = await buscarContextoOriginal(base44, codigoPedido, codigoPedidoIntegracao);
  const clienteLocal = await resolverCliente(base44, pedidoOriginal, espelhoOriginal, pedidoLocalOriginal);
  if (!clienteLocal) return { sucesso: false, erro: 'Cliente local não encontrado para duplicar o pedido', origem_codigo: codigoPedido };

  const cenarioCodigo = firstDefined(
    pedidoLocalOriginal?.cenario_fiscal_codigo,
    cab.codigo_cenario,
    cab.codigo_cenario_impostos,
    info.codigo_cenario,
    espelhoOriginal?.cenario_fiscal_codigo
  );
  const cenarioLocal = pedidoLocalOriginal?.cenario_local_id
    ? await base44.asServiceRole.entities.CenarioFiscalLocal.get(pedidoLocalOriginal.cenario_local_id).catch(() => null)
    : await resolverCenarioLocal(base44, cenarioCodigo);

  const plano = await resolverPlano(base44, espelhoOriginal, pedidoLocalOriginal);
  const tabela = await resolverTabela(base44, clienteLocal, pedidoLocalOriginal);
  const vendedorId = pedidoLocalOriginal?.vendedor_id || espelhoOriginal?.vendedor_id || vendedorAtual?.id || clienteLocal.vendedor_id || '';
  const vendedorNome = pedidoLocalOriginal?.vendedor_nome || espelhoOriginal?.vendedor_nome || vendedorAtual?.nome || '';

  const tipoOperacao = cenarioLocal?.tipo_operacao || pedidoLocalOriginal?.tipo || espelhoOriginal?.tipo_operacao || 'venda';
  const tipoPedido = ['venda', 'troca', 'bonificacao', 'devolucao'].includes(tipoOperacao) ? tipoOperacao : 'venda';
  const modeloNota = tipoPedido === 'troca' || clienteLocal.tipo_nota === 'D1' ? 'd1' : (pedidoLocalOriginal?.modelo_nota || '55');

  const itensCriar = [];
  let valorTotal = 0;

  for (const d of det) {
    const prodOmie = d.produto || {};
    const produtoLocal = await resolverProdutoLocal(base44, prodOmie);
    const quantidade = Number(prodOmie.quantidade) || 0;
    const valorUnitario = Number(prodOmie.valor_unitario) || 0;
    const valorItem = Number(prodOmie.valor_total) || quantidade * valorUnitario;
    valorTotal += valorItem;

    itensCriar.push({
      produto_id: produtoLocal?.id || String(prodOmie.codigo_produto_integracao || prodOmie.codigo_produto || ''),
      produto_codigo: produtoLocal?.codigo || String(prodOmie.codigo_produto_integracao || prodOmie.codigo_produto || ''),
      produto_nome: produtoLocal?.nome || prodOmie.descricao || '',
      produto_descricao: produtoLocal?.descricao || prodOmie.descricao || '',
      unidade_medida: prodOmie.unidade || '',
      quantidade,
      valor_unitario: valorUnitario,
      valor_total: valorItem,
      motivo_troca_id: d.inf_adic?.motivo_troca_id || '',
      motivo_troca_descricao: d.inf_adic?.motivo_troca_descricao || ''
    });
  }

  const dadosAdicionaisOriginais = String(firstDefined(pedidoLocalOriginal?.dados_adicionais_nf, info.dados_adicionais_nf, '') || '')
    .replace(/^Pedido Nº: .+?(\s*\|\s*|$)/, '')
    .trim();

  const novoPedido = await base44.asServiceRole.entities.Pedido.create({
    tipo: tipoPedido,
    origem: 'sistema',
    status: 'pendente',
    status_logistico: 'aguardando',
    etapa: 'comercial',
    cliente_id: clienteLocal.id,
    cliente_codigo: clienteLocal.codigo_interno || clienteLocal.codigo_integracao || clienteLocal.codigo_omie || '',
    cliente_nome: clienteLocal.razao_social || '',
    cliente_nome_fantasia: clienteLocal.nome_fantasia || '',
    cliente_cpf_cnpj: clienteLocal.cnpj_cpf || '',
    cliente_endereco: clienteLocal.endereco || '',
    cliente_numero: clienteLocal.numero || '',
    cliente_bairro: clienteLocal.bairro || '',
    cliente_cidade: clienteLocal.cidade || '',
    cliente_estado: clienteLocal.estado || '',
    cliente_cep: clienteLocal.cep || '',
    vendedor_id: vendedorId,
    vendedor_nome: vendedorNome,
    plano_pagamento_id: plano?.id || pedidoLocalOriginal?.plano_pagamento_id || clienteLocal.plano_pagamento_id || '',
    plano_pagamento_nome: plano?.nome || pedidoLocalOriginal?.plano_pagamento_nome || '',
    tabela_preco_id: tabela?.id || pedidoLocalOriginal?.tabela_preco_id || clienteLocal.tabela_id || '',
    tabela_preco_nome: tabela?.nome || pedidoLocalOriginal?.tabela_preco_nome || '',
    modelo_nota: modeloNota,
    cenario_local_id: cenarioLocal?.id || pedidoLocalOriginal?.cenario_local_id || '',
    cenario_local_nome: cenarioLocal?.nome || pedidoLocalOriginal?.cenario_local_nome || '',
    cenario_local_tipo: cenarioLocal?.tipo_operacao || pedidoLocalOriginal?.cenario_local_tipo || '',
    cenario_fiscal_codigo: cenarioCodigo ? Number(cenarioCodigo) : null,
    cenario_fiscal_nome: cenarioLocal?.cenario_omie_nome || cenarioLocal?.nome || pedidoLocalOriginal?.cenario_fiscal_nome || '',
    data_previsao_entrega: dateOmieToIso(firstDefined(pedidoLocalOriginal?.data_previsao_entrega, cab.data_previsao, espelhoOriginal?.data_previsao)),
    numero_pedido_compra: firstDefined(pedidoLocalOriginal?.numero_pedido_compra, info.numero_pedido_cliente, ''),
    dados_adicionais_nf: dadosAdicionaisOriginais,
    total_itens: itensCriar.length,
    valor_total: valorTotal,
    valor_desconto: pedidoLocalOriginal?.valor_desconto || 0,
    valor_frete: pedidoLocalOriginal?.valor_frete || 0,
    omie_enviado: false,
    omie_codigo_pedido: '',
    omie_erro: null,
    pedido_origem_id: pedidoLocalOriginal?.id || '',
    pedido_origem_numero: cab.numero_pedido || String(codigoPedido || ''),
    observacoes: pedidoLocalOriginal?.observacoes || `Duplicado a partir do pedido ${cab.numero_pedido || codigoPedido}`
  });

  for (const item of itensCriar) {
    await base44.asServiceRole.entities.PedidoItem.create({ pedido_id: novoPedido.id, ...item });
  }

  await base44.asServiceRole.functions.invoke('registrarLogGerencial', {
    tipo_acao: 'criacao',
    entidade_tipo: 'Pedido',
    entidade_id: novoPedido.id,
    entidade_descricao: `Pedido duplicado para envio (origem: ${cab.numero_pedido || codigoPedido})`,
    usuario_email: user.email,
    usuario_nome: user.full_name,
    descricao: `Duplicou pedido ${cab.numero_pedido || codigoPedido} para a tela de Envio como pendente`,
    origem: 'backend'
  }).catch(() => {});

  return {
    sucesso: true,
    origem_codigo: codigoPedido,
    origem_numero: cab.numero_pedido,
    pedido_local_id: novoPedido.id,
    mensagem: 'Pedido duplicado para a tela de Envio'
  };
}

Deno.serve(async (req) => {
  try {
    if (!APP_KEY || !APP_SECRET) {
      return Response.json({ sucesso: false, erro: 'Credenciais Omie não configuradas' }, { status: 500 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const vendedorAtual = await getCurrentVendedor(base44, user);
    if (user.role !== 'admin') {
      if (!vendedorAtual) return Response.json({ error: 'Funcionário não encontrado' }, { status: 403 });
      const permissoes = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedorAtual.id });
      const perm = permissoes[0];
      if (!perm?.permissoes_pedidos?.digitar_pedido_venda) {
        return Response.json({ error: 'Sem permissão para duplicar pedidos' }, { status: 403 });
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
      const resultado = await duplicarUm(base44, item, user, vendedorAtual);
      resultados.push(resultado);
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso).length;

    return Response.json({
      sucesso: erros === 0,
      total: resultados.length,
      sucessos,
      erros,
      resultados
    });
  } catch (error) {
    console.error('[duplicarPedidoOmie] Erro:', error.message);
    return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
  }
});