import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════
// exportarVendasItemDia — itens vendidos no dia com quantidade, venda,
// custo e margem por item, segmentados em varejo/rede.
//
// Header: api_key: <WEBHOOK_INDICADORES_TOKEN>
// Body JSON: { "data": "2026-06-06" }  (opcional — default = hoje)
//
// Fonte: Pedido (tipo=venda, status=faturado) + PedidoItem do dia.
// Custo: lido de PedidoItem.custo_unitario / Produto se existir; senão 0.
// Segmento: Cliente → Rede. Mapeia nomes para as redes oficiais do
// app financeiro (NOVO ATACAREJO, ASSAI, ARCOMIX, MIX MATHEUS, CARREFOUR).
// ═══════════════════════════════════════════════════════════════════

// Mapeia o nome da Rede (cadastro local) → valor oficial esperado pelo app financeiro.
// Chave = trecho normalizado do nome no banco; valor = string oficial de saída.
const MAPA_REDES_OFICIAIS = [
  { match: 'NOVO ATACAREJO', oficial: 'NOVO ATACAREJO' },
  { match: 'ASSAI', oficial: 'ASSAI' },
  { match: 'ARCOMIX', oficial: 'ARCOMIX' },
  { match: 'MIX MATEUS', oficial: 'MIX MATHEUS' },
  { match: 'MIX MATHEUS', oficial: 'MIX MATHEUS' },
  { match: 'CARREFOUR', oficial: 'CARREFOUR' }
];

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

// Converte um timestamp ISO (UTC) para o dia (YYYY-MM-DD) no fuso de Recife (UTC-3).
function diaLocalRecife(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

// Normaliza o nome de uma rede para o valor oficial, ou '' se não casar.
function mapearRedeOficial(nomeRede) {
  if (!nomeRede) return '';
  const up = String(nomeRede).toUpperCase().trim();
  for (const { match, oficial } of MAPA_REDES_OFICIAIS) {
    if (up.includes(match)) return oficial;
  }
  return '';
}

Deno.serve(async (req) => {
  // ── Auth (header api_key) ──
  const token = req.headers.get('api_key');
  const esperado = Deno.env.get('WEBHOOK_INDICADORES_TOKEN');
  if (!token || token !== esperado) {
    return Response.json({ error: 'Unauthorized', message: 'api_key inválido ou ausente' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const dataInput = body.data || url.searchParams.get('data');
  const data = (dataInput && /^\d{4}-\d{2}-\d{2}$/.test(dataInput))
    ? dataInput
    : new Date().toISOString().slice(0, 10);

  const base44 = createClientFromRequest(req);

  // ── Pedidos de venda faturados no dia ──
  const pedidos = await base44.asServiceRole.entities.Pedido.filter(
    { tipo: 'venda', status: 'faturado' }, '-data_faturamento', 50000
  );
  const pedidosDia = pedidos.filter(p => {
    const d = diaLocalRecife(p.data_faturamento || p.created_date);
    return d === data;
  });

  if (pedidosDia.length === 0) {
    return Response.json({ data, total_venda: 0, total_margem: 0, itens: [] });
  }

  // ── Carregar Clientes/Redes p/ segmentação + Produtos p/ EAN e custo ──
  const [clientes, redes, produtos] = await Promise.all([
    base44.asServiceRole.entities.Cliente.list('-created_date', 50000),
    base44.asServiceRole.entities.Rede.list(),
    base44.asServiceRole.entities.Produto.list('-created_date', 50000)
  ]);

  const clienteMap = new Map(clientes.map(c => [c.id, c]));
  const redeMap = new Map(redes.map(r => [r.id, r]));
  const produtoByCodigo = new Map(produtos.map(p => [String(p.codigo), p]));
  const produtoById = new Map(produtos.map(p => [p.id, p]));

  // Determina { segmento, rede } de um pedido a partir do cliente.
  function segmentar(pedido) {
    const cliente = clienteMap.get(pedido.cliente_id);
    if (!cliente?.rede_id) return { segmento: 'varejo', rede: '' };
    const rede = redeMap.get(cliente.rede_id);
    const redeOficial = mapearRedeOficial(rede?.nome);
    return redeOficial
      ? { segmento: 'rede', rede: redeOficial }
      : { segmento: 'varejo', rede: '' };
  }

  // ── Buscar itens dos pedidos do dia (paginado por pedido_id em lotes) ──
  const pedidoIds = pedidosDia.map(p => p.id);
  const pedidoInfo = new Map(pedidosDia.map(p => [p.id, segmentar(p)]));

  const itensTodos = [];
  const LOTE = 50;
  for (let i = 0; i < pedidoIds.length; i += LOTE) {
    const fatia = pedidoIds.slice(i, i + LOTE);
    const itens = await base44.asServiceRole.entities.PedidoItem.filter(
      { pedido_id: { $in: fatia } }, '-created_date', 50000
    );
    itensTodos.push(...itens);
  }

  // Resolve nome/EAN/custo de um item a partir do Produto cadastrado.
  function resolverProduto(item) {
    const prod = produtoById.get(item.produto_id) || produtoByCodigo.get(String(item.produto_codigo));
    const nome = item.produto_nome || prod?.nome || prod?.descricao || item.produto_descricao || 'SEM NOME';
    const codigo = prod?.cod_barras || '';
    // Custo unitário: campo do item, ou do produto (caso exista futuramente), senão 0.
    const custoUnit = Number(item.custo_unitario ?? prod?.custo_unitario ?? prod?.custo ?? 0) || 0;
    return { nome, codigo, custoUnit };
  }

  // ── Agregar por item + segmento + rede ──
  const agregado = new Map();
  for (const item of itensTodos) {
    const seg = pedidoInfo.get(item.pedido_id);
    if (!seg) continue;
    const { nome, codigo, custoUnit } = resolverProduto(item);
    const chave = `${nome}||${codigo}||${seg.segmento}||${seg.rede}`;

    const qtd = Number(item.quantidade) || 0;
    const venda = Number(item.valor_total) || 0;
    const custo = qtd * custoUnit;

    const ex = agregado.get(chave) || {
      codigo, item: nome, segmento: seg.segmento, rede: seg.rede,
      quantidade: 0, venda: 0, custo: 0, margem: 0
    };
    ex.quantidade += qtd;
    ex.venda += venda;
    ex.custo += custo;
    agregado.set(chave, ex);
  }

  const itens = Array.from(agregado.values()).map(r => ({
    codigo: r.codigo,
    item: r.item,
    segmento: r.segmento,
    rede: r.rede,
    quantidade: round2(r.quantidade),
    venda: round2(r.venda),
    custo: round2(r.custo),
    margem: round2(r.venda - r.custo)
  })).sort((a, b) => b.venda - a.venda);

  const total_venda = round2(itens.reduce((a, i) => a + i.venda, 0));
  const total_margem = round2(itens.reduce((a, i) => a + i.margem, 0));

  return Response.json({ data, total_venda, total_margem, itens });
});