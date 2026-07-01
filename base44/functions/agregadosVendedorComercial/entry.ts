import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Agrega Vendas / Trocas / Bonificações por vendedor no período + ranking de motivos
// de troca (contado POR ITEM, lendo PedidoItem.motivo_troca_id). Tudo no servidor para
// aguentar milhares de pedidos. Cancelados são ignorados das somas.
//
// payload: { inicio?: 'YYYY-MM-DD', fim?: 'YYYY-MM-DD', vendedor_nome?: string }
// retorna: { por_vendedor: [...], totais: {...}, motivos: [...], motivos_por_vendedor: {...} }

const STATUS_CANCELADO = ['cancelado', 'cancelado_pos_faturamento'];

function dataPedido(p) {
  return p.data_faturamento || p.created_date || '';
}

function dentroPeriodo(dataStr, inicio, fim) {
  if (!inicio && !fim) return true;
  if (!dataStr) return false;
  const d = new Date(String(dataStr).slice(0, 10)).getTime();
  if (isNaN(d)) return false;
  if (inicio && d < new Date(inicio).getTime()) return false;
  if (fim && d > new Date(fim).getTime() + 86400000) return false;
  return true;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const inicio = body.inicio || '';
    const fim = body.fim || '';
    const vendedorNomeFiltro = (body.vendedor_nome || '').trim();

    // VENDA não é mais calculada aqui — vem do EspelhoFaturamentoNF (fonte Omie) no front.
    // Apenas TROCA, BONIFICAÇÃO e MOTIVOS são tratados nesta função.
    const buscarTipo = async (tipo) => {
      const lista = await base44.asServiceRole.entities.Pedido.filter(
        { tipo }, '-data_faturamento', 20000
      );
      return lista.filter(p => !STATUS_CANCELADO.includes(p.status) && dentroPeriodo(dataPedido(p), inicio, fim));
    };

    const [trocas, bonificacoes] = await Promise.all([
      buscarTipo('troca'),
      buscarTipo('bonificacao')
    ]);

    const aplicarVendedor = (lista) =>
      vendedorNomeFiltro ? lista.filter(p => (p.vendedor_nome || '').trim() === vendedorNomeFiltro) : lista;

    const trocasF = aplicarVendedor(trocas);
    const bonifF = aplicarVendedor(bonificacoes);

    // Agregação por vendedor
    const mapa = new Map();
    const garantir = (nome) => {
      const chave = (nome || 'Sem vendedor').trim() || 'Sem vendedor';
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          vendedor_nome: chave,
          venda_valor: 0, venda_qtd: 0,
          troca_valor: 0, troca_qtd: 0,
          bonif_valor: 0, bonif_qtd: 0
        });
      }
      return mapa.get(chave);
    };

    // venda_valor/venda_qtd ficam zerados aqui — o front preenche com o EspelhoFaturamentoNF (fonte Omie).
    trocasF.forEach(p => { const r = garantir(p.vendedor_nome); r.troca_valor += p.valor_total || 0; r.troca_qtd += 1; });
    bonifF.forEach(p => { const r = garantir(p.vendedor_nome); r.bonif_valor += p.valor_total || 0; r.bonif_qtd += 1; });

    const por_vendedor = Array.from(mapa.values())
      .map(r => ({ ...r, perc_troca_venda: 0 }))
      .sort((a, b) => b.troca_valor - a.troca_valor);

    const totais = por_vendedor.reduce((acc, r) => ({
      venda_valor: acc.venda_valor + r.venda_valor, venda_qtd: acc.venda_qtd + r.venda_qtd,
      troca_valor: acc.troca_valor + r.troca_valor, troca_qtd: acc.troca_qtd + r.troca_qtd,
      bonif_valor: acc.bonif_valor + r.bonif_valor, bonif_qtd: acc.bonif_qtd + r.bonif_qtd
    }), { venda_valor: 0, venda_qtd: 0, troca_valor: 0, troca_qtd: 0, bonif_valor: 0, bonif_qtd: 0 });
    totais.perc_troca_venda = totais.venda_valor > 0 ? +((totais.troca_valor / totais.venda_valor) * 100).toFixed(1) : 0;

    // === RANKING DE MOTIVOS (por item) ===
    // O motivo NÃO está no Pedido (motivo_troca_id é null lá). Está em PedidoItem.motivo_troca_id.
    // Lê os itens das trocas do período em lote (filter 'in' por pedido_id, em chunks).
    const idsTroca = trocasF.map(p => p.id).filter(Boolean);
    const itensTroca = [];
    for (const grupo of chunk(idsTroca, 100)) {
      const itens = await base44.asServiceRole.entities.PedidoItem.filter(
        { pedido_id: { $in: grupo } }, '-created_date', 50000
      );
      itensTroca.push(...itens);
    }

    // Resolve nomes dos motivos
    const motivosEnt = await base44.asServiceRole.entities.MotivoTroca.list('-created_date', 500);
    const nomeMotivo = new Map(motivosEnt.map(m => [m.id, m.descricao]));

    // pedido_id -> vendedor_nome (para filtrar motivos por vendedor no front, se preciso)
    const vendPorPedido = new Map(trocasF.map(p => [p.id, (p.vendedor_nome || 'Sem vendedor').trim()]));

    const contagemMotivo = new Map(); // motivo -> qtd itens (geral)
    const contagemMotivoVend = {};    // vendedor -> { motivo -> qtd }
    let totalItensTroca = 0;

    itensTroca.forEach(it => {
      const mid = it.motivo_troca_id;
      const nome = it.motivo_troca_descricao || (mid ? nomeMotivo.get(mid) : null) || 'Sem motivo';
      const qtd = Number(it.quantidade) > 0 ? Number(it.quantidade) : 1;
      totalItensTroca += qtd;
      contagemMotivo.set(nome, (contagemMotivo.get(nome) || 0) + qtd);

      const vend = vendPorPedido.get(it.pedido_id) || 'Sem vendedor';
      if (!contagemMotivoVend[vend]) contagemMotivoVend[vend] = {};
      contagemMotivoVend[vend][nome] = (contagemMotivoVend[vend][nome] || 0) + qtd;
    });

    const montarRanking = (mapaContagem, total) =>
      Object.entries(mapaContagem instanceof Map ? Object.fromEntries(mapaContagem) : mapaContagem)
        .map(([motivo, qtd]) => ({ motivo, qtd, perc: total > 0 ? +((qtd / total) * 100).toFixed(1) : 0 }))
        .sort((a, b) => b.qtd - a.qtd);

    const motivos = montarRanking(contagemMotivo, totalItensTroca);

    const motivos_por_vendedor = {};
    Object.entries(contagemMotivoVend).forEach(([vend, mp]) => {
      const total = Object.values(mp).reduce((s, n) => s + n, 0);
      motivos_por_vendedor[vend] = montarRanking(mp, total);
    });

    return Response.json({
      por_vendedor,
      totais,
      motivos,
      motivos_por_vendedor,
      total_itens_troca: totalItensTroca,
      periodo: { inicio, fim },
      contagem: { trocas: trocasF.length, bonificacoes: bonifF.length }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});