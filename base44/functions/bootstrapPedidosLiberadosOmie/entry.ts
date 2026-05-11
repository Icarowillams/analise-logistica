import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// 🚀 BOOTSTRAP / RECONCILIAÇÃO do espelho PedidoLiberadoOmie
// Função única usada tanto para:
//   - popular o espelho na primeira vez
//   - reconciliar periodicamente (rede de segurança caso webhook falhe)
//
// Lógica de enriquecimento copiada de enriquecerPedidosCarga (mesma regra de negócio).

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizar = (v) => String(v || '').trim().toLowerCase();
const somenteDigitos = (v) => String(v || '').replace(/\D/g, '');
const valorValido = (v) => v !== undefined && v !== null && String(v).trim() !== '';

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const isTransient = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon') || res.status === 429;
    if (isTransient && tentativa < 3) {
      await delay(2500 * tentativa);
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

function pedidoCancelado(pedido) {
  const cab = pedido?.cabecalho || {};
  const info = [cab.cancelado, cab.status_pedido, cab.status, cab.etapa, cab.descricao_status].filter(Boolean).join(' ').toLowerCase();
  return cab.cancelado === 'S' || info.includes('cancelado') || info.includes('cancelada');
}

function criarIndicesClientes(clientes) {
  const indices = { porId: new Map(), porCodigo: new Map(), porDocumento: new Map(), porNome: new Map() };
  const indexarCodigo = (cli, cod) => { if (valorValido(cod)) indices.porCodigo.set(normalizar(cod), cli); };
  clientes.forEach((c) => {
    indices.porId.set(c.id, c);
    [c.codigo_omie, c.codigo, c.codigo_interno, c.codigo_integracao].forEach((cod) => indexarCodigo(c, cod));
    const doc = somenteDigitos(c.cnpj_cpf || c.cpf_cnpj);
    if (doc) indices.porDocumento.set(doc, c);
    [c.razao_social, c.nome_fantasia].filter(valorValido).forEach((n) => indices.porNome.set(normalizar(n), c));
  });
  return indices;
}

function buscarClienteLocal(pedidoOmie, pedidoLocal, indices) {
  if (pedidoLocal?.cliente_id && indices.porId.has(pedidoLocal.cliente_id)) return indices.porId.get(pedidoLocal.cliente_id);
  const codigos = [pedidoLocal?.cliente_codigo, pedidoOmie.codigo_cliente_integracao, pedidoOmie.codigo_cliente_cod, pedidoOmie.codigo_cliente].filter(valorValido);
  for (const cod of codigos) {
    const c = indices.porCodigo.get(normalizar(cod));
    if (c) return c;
  }
  const docs = [pedidoLocal?.cliente_cpf_cnpj, pedidoOmie.cnpj_cpf_cliente].map(somenteDigitos).filter((d) => d.length >= 11);
  for (const d of docs) {
    const c = indices.porDocumento.get(d);
    if (c) return c;
  }
  const nomes = [pedidoLocal?.cliente_nome_fantasia, pedidoLocal?.cliente_nome, pedidoOmie.nome_fantasia, pedidoOmie.nome_cliente].filter(valorValido);
  for (const n of nomes) {
    const c = indices.porNome.get(normalizar(n));
    if (c) return c;
  }
  return null;
}

function montarRegistroEspelho(pedidoOmie, indices, mapaRota, mapaVendedor, pedidoLocalPorOmie, origem) {
  const pedidoLocal = pedidoLocalPorOmie.get(String(pedidoOmie.codigo_pedido)) || null;
  const cliente = buscarClienteLocal(pedidoOmie, pedidoLocal, indices);
  const rotaNome = cliente?.rota_id ? (mapaRota.get(cliente.rota_id) || '') : (pedidoLocal?.rota_nome || '');
  const vendedorNome = cliente?.vendedor_id ? (mapaVendedor.get(cliente.vendedor_id) || '') : (pedidoLocal?.vendedor_nome || '');
  const nomeCliente = cliente?.razao_social || pedidoLocal?.cliente_nome || pedidoOmie.nome_cliente || `Cliente ${pedidoOmie.codigo_cliente || ''}`;
  const fantasia = cliente?.nome_fantasia || pedidoLocal?.cliente_nome_fantasia || pedidoOmie.nome_fantasia || nomeCliente;
  const codigoCliente = String(cliente?.codigo_interno || cliente?.codigo || cliente?.codigo_integracao || pedidoLocal?.cliente_codigo || pedidoOmie.codigo_cliente_cod || pedidoOmie.codigo_cliente_integracao || pedidoOmie.codigo_cliente || '');

  return {
    codigo_pedido: String(pedidoOmie.codigo_pedido),
    codigo_pedido_integracao: pedidoOmie.codigo_pedido_integracao || '',
    numero_pedido: String(pedidoOmie.numero_pedido || ''),
    etapa: String(pedidoOmie.etapa || '20'),
    codigo_cliente: String(pedidoOmie.codigo_cliente || ''),
    codigo_cliente_integracao: cliente?.codigo_integracao || cliente?.codigo || pedidoLocal?.cliente_codigo || pedidoOmie.codigo_cliente_integracao || '',
    codigo_cliente_cod: codigoCliente,
    cnpj_cpf_cliente: cliente?.cnpj_cpf || pedidoLocal?.cliente_cpf_cnpj || pedidoOmie.cnpj_cpf_cliente || '',
    cliente_id: cliente?.id || pedidoLocal?.cliente_id || null,
    nome_cliente: nomeCliente,
    nome_fantasia: fantasia,
    cidade: cliente?.cidade || pedidoLocal?.cliente_cidade || pedidoOmie.cidade || '',
    tipo_nota: cliente?.tipo_nota || pedidoLocal?.modelo_nota || '55',
    tags_cliente: cliente?.tags || [],
    motorista_padrao_id: cliente?.motorista_id || null,
    rota_id: cliente?.rota_id || pedidoLocal?.rota_id || null,
    rota_nome: rotaNome || 'Sem Rota',
    rota_cliente: rotaNome || 'Sem Rota',
    vendedor_id: cliente?.vendedor_id || pedidoLocal?.vendedor_id || null,
    vendedor_nome: vendedorNome,
    data_previsao: pedidoOmie.data_previsao || '',
    quantidade_itens: pedidoOmie.quantidade_itens || (pedidoOmie.produtos || []).length,
    valor_total_pedido: pedidoOmie.valor_total_pedido || 0,
    pedido_id: pedidoLocal?.id || null,
    produtos: pedidoOmie.produtos || [],
    sincronizado_em: new Date().toISOString(),
    origem_sync: origem
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { max_paginas = 10, origem = 'bootstrap' } = body;

    const t0 = Date.now();

    // 1. Buscar TODOS os pedidos etapa=20 do Omie (paginado)
    const todosOmie = [];
    let pagina = 1;
    let totalPaginas = 1;
    do {
      const data = await omieCall('ListarPedidos', {
        pagina,
        registros_por_pagina: 100,
        apenas_importado_api: 'N',
        etapa: '20'
      }).catch((e) => {
        if (/n[ãa]o existem registros/i.test(e.message)) return null;
        throw e;
      });
      if (!data) break;
      totalPaginas = Math.min(Number(data.total_de_paginas || 1), Number(max_paginas));
      const lote = (data.pedido_venda_produto || [])
        .filter((p) => !pedidoCancelado(p))
        .map((p) => ({
          codigo_pedido: String(p.cabecalho?.codigo_pedido || ''),
          codigo_pedido_integracao: p.cabecalho?.codigo_pedido_integracao || '',
          numero_pedido: p.cabecalho?.numero_pedido || '',
          codigo_cliente: String(p.cabecalho?.codigo_cliente || ''),
          data_previsao: p.cabecalho?.data_previsao || '',
          etapa: p.cabecalho?.etapa || '20',
          valor_total_pedido: p.total_pedido?.valor_total_pedido || 0,
          quantidade_itens: (p.det || []).length,
          produtos: (p.det || []).map((d) => ({
            codigo_produto: String(d.produto?.codigo_produto || ''),
            codigo_produto_integracao: d.produto?.codigo_produto_integracao || '',
            descricao: d.produto?.descricao || '',
            quantidade: d.produto?.quantidade || 0,
            valor_unitario: d.produto?.valor_unitario || 0,
            valor_total: d.produto?.valor_total || 0,
            unidade: d.produto?.unidade || ''
          }))
        }));
      todosOmie.push(...lote);
      pagina += 1;
      if (pagina <= totalPaginas) await delay(900);
    } while (pagina <= totalPaginas);

    // 2. Carregar cadastros locais (mesma lógica do enriquecerPedidosCarga)
    const [clientes, rotas, vendedores, pedidosLocais, espelhoAtual] = await Promise.all([
      base44.asServiceRole.entities.Cliente.list('-created_date', 10000),
      base44.asServiceRole.entities.Rota.list('-created_date', 1000),
      base44.asServiceRole.entities.Vendedor.list('-created_date', 1000),
      base44.asServiceRole.entities.Pedido.list('-created_date', 5000),
      base44.asServiceRole.entities.PedidoLiberadoOmie.list('-created_date', 5000)
    ]);

    const indices = criarIndicesClientes(clientes || []);
    const mapaRota = new Map((rotas || []).map((r) => [r.id, r.nome]));
    const mapaVendedor = new Map((vendedores || []).map((v) => [v.id, v.nome]));
    const pedidoLocalPorOmie = new Map();
    (pedidosLocais || []).forEach((p) => {
      if (p.omie_codigo_pedido) pedidoLocalPorOmie.set(String(p.omie_codigo_pedido), p);
    });

    const espelhoPorCodigo = new Map((espelhoAtual || []).map((e) => [String(e.codigo_pedido), e]));
    const codigosOmieAtuais = new Set(todosOmie.map((p) => String(p.codigo_pedido)));

    // 3. UPSERT (criar/atualizar) — sequencial para não estourar limite
    let criados = 0;
    let atualizados = 0;
    for (const pedidoOmie of todosOmie) {
      const registro = montarRegistroEspelho(pedidoOmie, indices, mapaRota, mapaVendedor, pedidoLocalPorOmie, origem);
      const existente = espelhoPorCodigo.get(registro.codigo_pedido);
      if (existente) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(existente.id, registro);
        atualizados += 1;
      } else {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.create(registro);
        criados += 1;
      }
    }

    // 4. DELETE: pedidos que estavam no espelho mas não estão mais na etapa 20
    let removidos = 0;
    for (const espelho of (espelhoAtual || [])) {
      if (!codigosOmieAtuais.has(String(espelho.codigo_pedido))) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.delete(espelho.id);
        removidos += 1;
      }
    }

    const duracao = Date.now() - t0;
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'ListarPedidos',
      operacao: origem === 'reconciliacao' ? 'reconciliar_espelho_pedidos' : 'bootstrap_espelho_pedidos',
      status: 'sucesso',
      duracao_ms: duracao,
      payload_resposta: JSON.stringify({ total_omie: todosOmie.length, criados, atualizados, removidos }).slice(0, 2000)
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      total_omie: todosOmie.length,
      criados,
      atualizados,
      removidos,
      duracao_ms: duracao
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});