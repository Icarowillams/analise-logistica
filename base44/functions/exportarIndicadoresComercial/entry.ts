import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════
// exportarIndicadoresComercial — 7 indicadores do setor Comercial
// ═══════════════════════════════════════════════════════════════════
//
// POST body: { mes: "janeiro"..."dezembro", ano: 2026, custo_comercial_total?: number }
// Header:    x-api-key: <WEBHOOK_INDICADORES_TOKEN>
//
// Indicadores:
//   01. trocas_por_vencimento (%) — valor trocas vencimento / faturamento × 100
//   02. faturamento_mensal (R$) — soma valor_total pedidos venda faturados
//   03. faturamento_mensal_varejo (%) — fat varejo / fat total × 100
//   04. preco_medio_liquidez (R$) — faturamento / pacotes vendidos
//   05. positivacao (%) — clientes que compraram / clientes ativos × 100
//   06. pacotes_liquidos_vendidos — soma total_itens pedidos venda faturados
//   07. custo_comercial (R$) — custo_comercial_total / pacotes vendidos
// ═══════════════════════════════════════════════════════════════════

const MESES_VALIDOS = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
};

// Rede "SEM REDE" (cod=0) — id fixo no banco. Clientes sem rede_id ou com essa rede = varejo.
const REDE_SEM_REDE_COD = '0';
// Segmento "ATACADO" — clientes com esse segmento são excluídos do varejo.
const SEGMENTO_ATACADO_NOME = 'ATACADO';

function dentroPeriodo(dataStr, inicio, fim) {
  if (!dataStr) return false;
  const d = dataStr.slice(0, 10);
  return d >= inicio && d <= fim;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

Deno.serve(async (req) => {
  // ── Auth ──
  const token = req.headers.get('x-api-key');
  const esperado = Deno.env.get('WEBHOOK_INDICADORES_TOKEN');
  if (!token || token !== esperado) {
    return Response.json({ error: 'Unauthorized', message: 'x-api-key inválido ou ausente' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { mes, ano, custo_comercial_total } = body;

  if (!mes || !MESES_VALIDOS[mes]) {
    return Response.json({
      error: 'Mês inválido',
      meses_validos: Object.keys(MESES_VALIDOS),
      exemplo: { mes: 'junho', ano: 2026 }
    }, { status: 400 });
  }
  if (!ano || typeof ano !== 'number') {
    return Response.json({ error: 'Ano inválido — envie um número (ex: 2026)' }, { status: 400 });
  }

  const mesNum = MESES_VALIDOS[mes];
  const inicio = `${ano}-${String(mesNum).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mesNum, 0).getDate();
  const fim = `${ano}-${String(mesNum).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

  const base44 = createClientFromRequest(req);

  // ── Buscar dados em paralelo ──
  const [
    pedidosVenda,
    pedidosTroca,
    trocasVisita,
    clientes,
    segmentos,
    redes
  ] = await Promise.all([
    base44.asServiceRole.entities.Pedido.filter({ tipo: 'venda', status: 'faturado' }, '-data_faturamento', 50000),
    base44.asServiceRole.entities.PedidoTroca.list('-created_date', 20000),
    base44.asServiceRole.entities.TrocaVisita.list('-created_date', 20000),
    base44.asServiceRole.entities.Cliente.filter({ status: 'ativo' }, '-created_date', 50000),
    base44.asServiceRole.entities.Segmento.list(),
    base44.asServiceRole.entities.Rede.list()
  ]);

  // ── Mapas auxiliares ──
  const segmentoMap = new Map(segmentos.map(s => [s.id, s.nome?.toUpperCase()]));
  const redeMap = new Map(redes.map(r => [r.id, r.cod]));

  // Determina se um cliente é varejo:
  // Varejo = NÃO tem rede (ou rede "SEM REDE" cod=0) E segmento NÃO é "ATACADO"
  function isVarejo(cliente) {
    const redeId = cliente.rede_id;
    const temRede = redeId && redeMap.has(redeId) && redeMap.get(redeId) !== REDE_SEM_REDE_COD;
    const segNome = segmentoMap.get(cliente.segmento_id) || '';
    const isAtacado = segNome === SEGMENTO_ATACADO_NOME;
    return !temRede && !isAtacado;
  }

  const clienteMap = new Map(clientes.map(c => [c.id, c]));
  const clientesVarejoIds = new Set(clientes.filter(isVarejo).map(c => c.id));

  // ── Filtrar pedidos de venda no período ──
  const vendaFilt = pedidosVenda.filter(p =>
    dentroPeriodo(p.data_faturamento || p.created_date, inicio, fim)
  );

  // ── INDIC 02: Faturamento mensal ──
  const faturamento_total = round2(vendaFilt.reduce((a, p) => a + (p.valor_total || 0), 0));

  // ── INDIC 06: Pacotes líquidos vendidos ──
  const pacotes_vendidos = vendaFilt.reduce((a, p) => a + (p.total_itens || 0), 0);

  // ── INDIC 04: Preço médio liquidez ──
  const preco_medio_liquidez = pacotes_vendidos > 0 ? round2(faturamento_total / pacotes_vendidos) : null;

  // ── INDIC 03: Faturamento mensal varejo (%) ──
  const faturamento_varejo = round2(vendaFilt
    .filter(p => clientesVarejoIds.has(p.cliente_id))
    .reduce((a, p) => a + (p.valor_total || 0), 0));
  const faturamento_mensal_varejo = faturamento_total > 0
    ? round2((faturamento_varejo / faturamento_total) * 100)
    : null;

  // ── INDIC 05: Positivação ──
  const clientes_ativos_total = clientes.length;
  const clientes_que_compraram = new Set(vendaFilt.map(p => p.cliente_id)).size;
  const positivacao = clientes_ativos_total > 0
    ? round2((clientes_que_compraram / clientes_ativos_total) * 100)
    : null;

  // ── INDIC 01: Trocas por vencimento (%) ──
  // Fonte 1: PedidoTroca com origem='vencimento' no período
  const trocasVencPedido = pedidosTroca.filter(t =>
    t.origem === 'vencimento' &&
    dentroPeriodo(t.data_troca || t.created_date, inicio, fim)
  );
  const valorTrocasVencPedido = trocasVencPedido.reduce((a, t) => a + (t.valor_total || 0), 0);

  // Fonte 2: TrocaVisita com motivo contendo "vencid" (VENCIDO) no período
  const trocasVencVisita = trocasVisita.filter(t => {
    const motivo = (t.motivo_troca || '').toUpperCase();
    return (motivo.includes('VENCID') || motivo.includes('VENCIMENTO')) &&
      dentroPeriodo(t.created_date, inicio, fim);
  });
  // TrocaVisita não tem valor_total — estima pelo preço do produto (quantidade × valor médio)
  // Para simplicidade, usamos apenas o valor dos PedidoTroca (que são os faturados/oficiais)
  const valor_trocas_vencimento = round2(valorTrocasVencPedido);

  const trocas_por_vencimento = faturamento_total > 0
    ? round2((valor_trocas_vencimento / faturamento_total) * 100)
    : null;

  // ── INDIC 07: Custo comercial (R$ por pacote) ──
  // Não existe dado de custo no sistema — precisa ser informado via payload
  const custo_comercial = (typeof custo_comercial_total === 'number' && pacotes_vendidos > 0)
    ? round2(custo_comercial_total / pacotes_vendidos)
    : null;

  // ── Resposta ──
  return Response.json({
    setor: 'comercial',
    mes,
    ano,
    periodo: { inicio, fim },
    indicadores: {
      trocas_por_vencimento,
      faturamento_mensal: faturamento_total,
      faturamento_mensal_varejo,
      preco_medio_liquidez,
      positivacao,
      pacotes_liquidos_vendidos: pacotes_vendidos,
      custo_comercial
    },
    detalhamento: {
      total_pedidos_venda: vendaFilt.length,
      clientes_ativos_base: clientes_ativos_total,
      clientes_que_compraram,
      faturamento_varejo,
      faturamento_nao_varejo: round2(faturamento_total - faturamento_varejo),
      valor_trocas_vencimento,
      qtd_trocas_vencimento_pedido: trocasVencPedido.length,
      qtd_trocas_vencimento_visita: trocasVencVisita.length,
      custo_comercial_total_informado: custo_comercial_total ?? null
    }
  });
});