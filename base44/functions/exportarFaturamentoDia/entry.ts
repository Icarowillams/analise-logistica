import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════
// exportarFaturamentoDia — faturamento líquido + quantidade vendida do dia
// Consumida por outro app Base44 (app da Fábrica).
//
// Header: api_key: <FATURAMENTO_API_KEY>
// Body JSON: { "data": "YYYY-MM-DD" }  (opcional — default = hoje)
//
// Fonte: Pedido (tipo=venda, status=faturado) + PedidoItem do dia.
// valor_liquido_vendas = soma de valor_total dos itens (líquido por item).
// quantidade_vendida   = soma de quantidade dos itens (pacotes/unidades).
// ═══════════════════════════════════════════════════════════════════

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

Deno.serve(async (req) => {
  try {
    // ── Auth (header api_key) ──
    const token = req.headers.get('api_key');
    const esperado = Deno.env.get('FATURAMENTO_API_KEY');
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
      return Response.json({ data, valor_liquido_vendas: 0, quantidade_vendida: 0 });
    }

    // ── Buscar itens dos pedidos do dia (paginado por pedido_id em lotes) ──
    const pedidoIds = pedidosDia.map(p => p.id);
    let valor_liquido_vendas = 0;
    let quantidade_vendida = 0;

    const LOTE = 50;
    for (let i = 0; i < pedidoIds.length; i += LOTE) {
      const fatia = pedidoIds.slice(i, i + LOTE);
      const itens = await base44.asServiceRole.entities.PedidoItem.filter(
        { pedido_id: { $in: fatia } }, '-created_date', 50000
      );
      for (const item of itens) {
        valor_liquido_vendas += Number(item.valor_total) || 0;
        quantidade_vendida += Number(item.quantidade) || 0;
      }
    }

    return Response.json({
      data,
      valor_liquido_vendas: round2(valor_liquido_vendas),
      quantidade_vendida: round2(quantidade_vendida)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});