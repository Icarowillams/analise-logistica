import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function diasUteisMes(ano, mes) {
  let count = 0;
  const diasNoMes = new Date(ano, mes, 0).getDate();
  for (let d = 1; d <= diasNoMes; d++) {
    const dow = new Date(ano, mes - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const agora = new Date();
    const mes = agora.getMonth() + 1;
    const ano = agora.getFullYear();
    const mesInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const mesFim = `${ano}-${String(mes).padStart(2, '0')}-${new Date(ano, mes, 0).getDate()}`;
    const duMes = diasUteisMes(ano, mes);

    // Buscar dados
    const [pedidos, metas, vendedores, acertos, visitas, clientes] = await Promise.all([
      base44.entities.Pedido.filter({ tipo: 'venda' }, '-created_date', 3000),
      base44.entities.Meta.filter({ tipo: 'vendas' }, '-periodo_inicio', 200),
      base44.entities.Vendedor.filter({ status: 'ativo' }),
      base44.entities.AcertoCaixa.list('-created_date', 500),
      base44.entities.VisitaRoteiro.list('-created_date', 3000),
      base44.entities.Cliente.filter({ status: 'ativo' }),
    ]);

    const totalClientes = clientes.length;

    // Filtrar pedidos do mes
    const pedidosMes = pedidos.filter(p => {
      const d = p.created_date?.slice(0, 10) || '';
      return d >= mesInicio && d <= mesFim;
    });

    // Filtrar metas do mes
    const metasDoMes = metas.filter(m =>
      m.periodo_inicio >= mesInicio && m.periodo_inicio <= mesFim ||
      m.periodo_fim >= mesInicio && m.periodo_fim <= mesFim ||
      (m.periodo_inicio <= mesInicio && m.periodo_fim >= mesFim)
    );

    // Filtrar acertos do mes
    const acertosMes = acertos.filter(a => {
      const d = a.created_date?.slice(0, 10) || a.data_acerto || '';
      return d >= mesInicio && d <= mesFim;
    });

    // Filtrar visitas do mes
    const visitasMes = visitas.filter(v => {
      const d = v.data_visita || v.created_date?.slice(0, 10) || '';
      return d >= mesInicio && d <= mesFim;
    });

    // Por vendedor
    const porVendedor = new Map();
    for (const v of vendedores) {
      porVendedor.set(v.id, {
        nome: v.nome,
        meta: 0,
        realizado: 0,
        pacotes: 0,
        pedidos: 0,
        cobrado: 0,
        acertos: 0,
        visitas: 0,
        visitas_concluidas: 0,
        clientes_visitados: new Set(),
      });
    }

    for (const p of pedidosMes) {
      const vid = p.vendedor_id || '__';
      if (!porVendedor.has(vid)) porVendedor.set(vid, { nome: p.vendedor_nome || '—', meta: 0, realizado: 0, pacotes: 0, pedidos: 0, cobrado: 0, acertos: 0, visitas: 0, visitas_concluidas: 0, clientes_visitados: new Set() });
      const d = porVendedor.get(vid);
      d.realizado += Number(p.valor_total || 0);
      d.pacotes += Number(p.qtd_total_itens || 0);
      d.pedidos += 1;
    }

    for (const m of metasDoMes) {
      const vid = m.vendedor_id;
      if (porVendedor.has(vid)) porVendedor.get(vid).meta = Number(m.valor_meta || 0);
    }

    for (const a of acertosMes) {
      const vid = a.vendedor_id || '__';
      if (!porVendedor.has(vid)) porVendedor.set(vid, { nome: a.vendedor_nome || '—', meta: 0, realizado: 0, pacotes: 0, pedidos: 0, cobrado: 0, acertos: 0, visitas: 0, visitas_concluidas: 0, clientes_visitados: new Set() });
      const d = porVendedor.get(vid);
      d.cobrado += Number(a.valor_total || a.valor_recebido || 0);
      d.acertos += 1;
    }

    for (const v of visitasMes) {
      const vid = v.vendedor_id || '__';
      if (!porVendedor.has(vid)) porVendedor.set(vid, { nome: v.vendedor_nome || '—', meta: 0, realizado: 0, pacotes: 0, pedidos: 0, cobrado: 0, acertos: 0, visitas: 0, visitas_concluidas: 0, clientes_visitados: new Set() });
      const d = porVendedor.get(vid);
      d.visitas += 1;
      if (v.status === 'concluida') d.visitas_concluidas += 1;
      if (v.cliente_id) d.clientes_visitados.add(v.cliente_id);
    }

    const ranking = Array.from(porVendedor.values()).map(d => {
      const pct = d.meta > 0 ? (d.realizado / d.meta) * 100 : 0;
      const pm = d.pacotes > 0 ? d.realizado / d.pacotes : 0;
      const pctCobranca = d.realizado > 0 ? (d.cobrado / d.realizado) * 100 : 0;
      return {
        nome: d.nome,
        meta: Number(d.meta.toFixed(2)),
        realizado: Number(d.realizado.toFixed(2)),
        pct_atingimento: Number(pct.toFixed(1)),
        pm: Number(pm.toFixed(2)),
        pacotes: d.pacotes,
        pedidos: d.pedidos,
        cobrado: Number(d.cobrado.toFixed(2)),
        pct_cobranca: Number(pctCobranca.toFixed(1)),
        visitas: d.visitas,
        visitas_concluidas: d.visitas_concluidas,
        clientes_visitados: d.clientes_visitados.size,
      };
    }).sort((a, b) => b.realizado - a.realizado);

    const totalRealizado = ranking.reduce((s, d) => s + d.realizado, 0);
    const totalMeta = ranking.reduce((s, d) => s + d.meta, 0);
    const totalPacotes = ranking.reduce((s, d) => s + d.pacotes, 0);
    const pmGeral = totalPacotes > 0 ? totalRealizado / totalPacotes : 0;
    const totalCobrado = ranking.reduce((s, d) => s + d.cobrado, 0);
    const totalVisitas = ranking.reduce((s, d) => s + d.visitas, 0);

    const clienteSet = new Set();
    for (const d of porVendedor.values()) for (const cid of d.clientes_visitados) clienteSet.add(cid);

    const resumo = {
      mes: `${mes}/${ano}`,
      dias_uteis: duMes,
      total_meta: Number(totalMeta.toFixed(2)),
      total_realizado: Number(totalRealizado.toFixed(2)),
      pct_atingimento: Number((totalMeta > 0 ? (totalRealizado / totalMeta) * 100 : 0).toFixed(1)),
      pm_geral: Number(pmGeral.toFixed(2)),
      pm_benchmark: 5.17,
      total_pacotes: totalPacotes,
      total_cobrado: Number(totalCobrado.toFixed(2)),
      pct_cobranca: Number((totalRealizado > 0 ? (totalCobrado / totalRealizado) * 100 : 0).toFixed(1)),
      total_visitas: totalVisitas,
      total_clientes_base: totalClientes,
      clientes_visitados: clienteSet.size,
      pct_cobertura: Number((totalClientes > 0 ? (clienteSet.size / totalClientes) * 100 : 0).toFixed(1)),
      ranking: ranking.map(d => ({ ...d, clientes_visitados: Number(d.clientes_visitados) })),
    };

    return Response.json(resumo);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});