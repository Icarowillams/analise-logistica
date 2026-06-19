import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Meta de Troca por VENCIDO.
// Calcula, por vendedor, no período: pacotes VENDIDOS vs pacotes de VENCIDO (e mofado opcional),
// o % de vencido sobre vendido, e a economia/bonificação quando o vendedor fica abaixo do teto.
//
// payload: {
//   inicio?: 'YYYY-MM-DD', fim?: 'YYYY-MM-DD',
//   teto_perc?: number (default 5),
//   custo_pacote?: number (custo/preço médio do pacote para converter economia em R$; default = preço médio real das trocas)
// }
//
// retorna: { por_vendedor: [...], totais: {...}, parametros: {...} }

const STATUS_CANCELADO = ['cancelado', 'cancelado_pos_faturamento'];
const MOTIVOS_VENCIDO = ['VENCIDO'];

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
function somaPacotes(itens) {
  return itens.reduce((s, it) => s + (Number(it.quantidade) > 0 ? Number(it.quantidade) : 0), 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const inicio = body.inicio || '';
    const fim = body.fim || '';
    const tetoPerc = Number(body.teto_perc) > 0 ? Number(body.teto_perc) : 5;
    let custoPacote = Number(body.custo_pacote) > 0 ? Number(body.custo_pacote) : 0;

    // Busca vendas e trocas do período
    const buscarTipo = async (tipo) => {
      const lista = await base44.asServiceRole.entities.Pedido.filter(
        { tipo }, '-data_faturamento', 20000
      );
      return lista.filter(p => !STATUS_CANCELADO.includes(p.status) && dentroPeriodo(dataPedido(p), inicio, fim));
    };

    const [vendas, trocas] = await Promise.all([
      buscarTipo('venda'),
      buscarTipo('troca')
    ]);

    // ===== Pacotes VENDIDOS por vendedor =====
    // Usa qtd_total_itens do Pedido quando existir (evita varrer milhares de itens de venda).
    const vendidoPorVend = new Map();
    let faltamItens = [];
    vendas.forEach(p => {
      const nome = (p.vendedor_nome || 'Sem vendedor').trim() || 'Sem vendedor';
      const q = Number(p.qtd_total_itens);
      if (q > 0) {
        vendidoPorVend.set(nome, (vendidoPorVend.get(nome) || 0) + q);
      } else {
        faltamItens.push(p);
      }
    });
    // Para pedidos sem qtd_total_itens, soma os itens em lote
    if (faltamItens.length > 0) {
      const idsSemQtd = faltamItens.map(p => p.id).filter(Boolean);
      const vendPorPed = new Map(faltamItens.map(p => [p.id, (p.vendedor_nome || 'Sem vendedor').trim() || 'Sem vendedor']));
      for (const grupo of chunk(idsSemQtd, 100)) {
        const itens = await base44.asServiceRole.entities.PedidoItem.filter(
          { pedido_id: { $in: grupo } }, '-created_date', 50000
        );
        itens.forEach(it => {
          const nome = vendPorPed.get(it.pedido_id);
          if (!nome) return;
          const q = Number(it.quantidade) > 0 ? Number(it.quantidade) : 0;
          vendidoPorVend.set(nome, (vendidoPorVend.get(nome) || 0) + q);
        });
      }
    }

    // ===== Itens de TROCA por vendedor (para isolar VENCIDO) =====
    const idsTroca = trocas.map(p => p.id).filter(Boolean);
    const vendPorTroca = new Map(trocas.map(p => [p.id, (p.vendedor_nome || 'Sem vendedor').trim() || 'Sem vendedor']));

    const motivosEnt = await base44.asServiceRole.entities.MotivoTroca.list('-created_date', 500);
    const nomeMotivo = new Map(motivosEnt.map(m => [m.id, (m.descricao || '').toUpperCase()]));

    // vendedor -> { vencido_pacotes, vencido_valor, troca_pacotes, troca_valor }
    const trocaPorVend = new Map();
    const garantirTroca = (nome) => {
      if (!trocaPorVend.has(nome)) trocaPorVend.set(nome, { vencido_pacotes: 0, vencido_valor: 0, troca_pacotes: 0, troca_valor: 0 });
      return trocaPorVend.get(nome);
    };

    let totalPacotesTrocaGeral = 0;
    let totalValorTrocaGeral = 0;

    for (const grupo of chunk(idsTroca, 100)) {
      const itens = await base44.asServiceRole.entities.PedidoItem.filter(
        { pedido_id: { $in: grupo } }, '-created_date', 50000
      );
      itens.forEach(it => {
        const nome = vendPorTroca.get(it.pedido_id) || 'Sem vendedor';
        const q = Number(it.quantidade) > 0 ? Number(it.quantidade) : 0;
        const v = Number(it.valor_total) || 0;
        const motivo = (it.motivo_troca_descricao || (it.motivo_troca_id ? nomeMotivo.get(it.motivo_troca_id) : '') || '').toUpperCase();
        const r = garantirTroca(nome);
        r.troca_pacotes += q;
        r.troca_valor += v;
        totalPacotesTrocaGeral += q;
        totalValorTrocaGeral += v;
        if (MOTIVOS_VENCIDO.includes(motivo)) {
          r.vencido_pacotes += q;
          r.vencido_valor += v;
        }
      });
    }

    // Preço médio real do pacote de troca (para converter economia em R$ quando custo não informado)
    const precoMedioTroca = totalPacotesTrocaGeral > 0 ? totalValorTrocaGeral / totalPacotesTrocaGeral : 0;
    if (custoPacote <= 0) custoPacote = +precoMedioTroca.toFixed(4);

    // ===== Monta resultado por vendedor =====
    const nomes = new Set([...vendidoPorVend.keys(), ...trocaPorVend.keys()]);
    const por_vendedor = [];
    nomes.forEach(nome => {
      if (nome === 'Sem vendedor') return;
      const vendidos = vendidoPorVend.get(nome) || 0;
      const t = trocaPorVend.get(nome) || { vencido_pacotes: 0, vencido_valor: 0, troca_pacotes: 0, troca_valor: 0 };
      const percVencido = vendidos > 0 ? +((t.vencido_pacotes / vendidos) * 100).toFixed(2) : 0;

      // Economia: quanto ficou ABAIXO do teto, em pacotes -> R$
      const tetoPacotes = vendidos * (tetoPerc / 100);
      const pacotesEconomizados = Math.max(0, tetoPacotes - t.vencido_pacotes);
      const economia_valor = +(pacotesEconomizados * custoPacote).toFixed(2);
      const dentro_meta = vendidos > 0 && percVencido <= tetoPerc;

      por_vendedor.push({
        vendedor_nome: nome,
        pacotes_vendidos: Math.round(vendidos),
        vencido_pacotes: Math.round(t.vencido_pacotes),
        vencido_valor: +t.vencido_valor.toFixed(2),
        troca_pacotes: Math.round(t.troca_pacotes),
        troca_valor: +t.troca_valor.toFixed(2),
        perc_vencido: percVencido,
        teto_perc: tetoPerc,
        dentro_meta,
        pacotes_economizados: +pacotesEconomizados.toFixed(1),
        economia_valor
      });
    });

    por_vendedor.sort((a, b) => a.perc_vencido - b.perc_vencido);

    const totais = por_vendedor.reduce((acc, r) => ({
      pacotes_vendidos: acc.pacotes_vendidos + r.pacotes_vendidos,
      vencido_pacotes: acc.vencido_pacotes + r.vencido_pacotes,
      vencido_valor: acc.vencido_valor + r.vencido_valor,
      troca_pacotes: acc.troca_pacotes + r.troca_pacotes,
      troca_valor: acc.troca_valor + r.troca_valor,
      economia_valor: acc.economia_valor + r.economia_valor
    }), { pacotes_vendidos: 0, vencido_pacotes: 0, vencido_valor: 0, troca_pacotes: 0, troca_valor: 0, economia_valor: 0 });
    totais.perc_vencido = totais.pacotes_vendidos > 0 ? +((totais.vencido_pacotes / totais.pacotes_vendidos) * 100).toFixed(2) : 0;
    totais.economia_valor = +totais.economia_valor.toFixed(2);
    totais.vencido_valor = +totais.vencido_valor.toFixed(2);
    totais.troca_valor = +totais.troca_valor.toFixed(2);
    totais.dentro_meta = por_vendedor.filter(r => r.dentro_meta).length;
    totais.acima_meta = por_vendedor.filter(r => !r.dentro_meta && r.pacotes_vendidos > 0).length;

    return Response.json({
      por_vendedor,
      totais,
      parametros: {
        inicio, fim, teto_perc: tetoPerc,
        custo_pacote: +custoPacote.toFixed(4),
        preco_medio_troca: +precoMedioTroca.toFixed(4)
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});