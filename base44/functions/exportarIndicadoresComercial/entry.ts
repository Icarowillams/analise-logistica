import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const MESES_VALIDOS = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
};

function normalizar(nome) {
  return nome
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function dentroPeriodo(dataStr, inicio, fim) {
  if (!dataStr) return false;
  const d = dataStr.slice(0, 10);
  return d >= inicio && d <= fim;
}

Deno.serve(async (req) => {
  // Auth via token
  const token = req.headers.get('x-api-key');
  const esperado = Deno.env.get('WEBHOOK_INDICADORES_TOKEN');
  if (!token || token !== esperado) {
    return Response.json({ error: 'Unauthorized', message: 'x-api-key inválido ou ausente' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { mes, ano } = body;

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

  // Buscar dados em paralelo
  const [pedidosVenda, pedidosTroca, pedidosBonif, visitas, cortes, clientes, metas] = await Promise.all([
    base44.asServiceRole.entities.Pedido.filter({ tipo: 'venda', status: 'faturado' }, '-data_faturamento', 50000),
    base44.asServiceRole.entities.Pedido.filter({ tipo: 'troca', status: 'faturado' }, '-data_faturamento', 50000),
    base44.asServiceRole.entities.Pedido.filter({ tipo: 'bonificacao', status: 'faturado' }, '-data_faturamento', 10000),
    base44.asServiceRole.entities.VisitaRoteiro.list('-updated_date', 50000),
    base44.asServiceRole.entities.LogCorte.list('-created_date', 20000),
    base44.asServiceRole.entities.Cliente.list('-created_date', 50000),
    base44.asServiceRole.entities.Meta.filter({ tipo: 'venda' }, '-periodo_inicio', 500)
  ]);

  // Filtrar por período
  const vendaFilt = pedidosVenda.filter(p => dentroPeriodo(p.data_faturamento || p.created_date, inicio, fim));
  const trocaFilt = pedidosTroca.filter(p => dentroPeriodo(p.data_faturamento || p.created_date, inicio, fim));
  const bonifFilt = pedidosBonif.filter(p => dentroPeriodo(p.data_faturamento || p.created_date, inicio, fim));
  const visitasFilt = visitas.filter(v => dentroPeriodo(v.data_visita || v.created_date, inicio, fim));
  const cortesFilt = cortes.filter(c => dentroPeriodo(c.created_date, inicio, fim));
  const clientesNovos = clientes.filter(c => dentroPeriodo(c.created_date, inicio, fim));

  // Calcular indicadores
  const faturamento_total = vendaFilt.reduce((a, p) => a + (p.valor_total || 0), 0);
  const total_pedidos = vendaFilt.length;
  const ticket_medio = total_pedidos > 0 ? Math.round((faturamento_total / total_pedidos) * 100) / 100 : null;
  const clientes_ativos = new Set(vendaFilt.map(p => p.cliente_id)).size;
  const total_itens_vendidos = vendaFilt.reduce((a, p) => a + (p.total_itens || 0), 0);

  const valor_trocas = trocaFilt.reduce((a, p) => a + (p.valor_total || 0), 0);
  const total_trocas = trocaFilt.length;
  const percentual_trocas = faturamento_total > 0 ? Math.round((valor_trocas / faturamento_total) * 1000) / 10 : null;

  const valor_bonificacoes = bonifFilt.reduce((a, p) => a + (p.valor_total || 0), 0);
  const total_bonificacoes = bonifFilt.length;
  const percentual_bonificacoes = faturamento_total > 0 ? Math.round((valor_bonificacoes / faturamento_total) * 1000) / 10 : null;

  const total_visitas = visitasFilt.length;
  const visitas_realizadas = visitasFilt.filter(v => v.status === 'visitado').length;
  const taxa_sucesso_visitas = total_visitas > 0 ? Math.round((visitas_realizadas / total_visitas) * 1000) / 10 : null;
  const visitas_com_pedido = visitasFilt.filter(v => v.gerou_pedido).length;
  const taxa_de_conversao = visitas_realizadas > 0 ? Math.round((visitas_com_pedido / visitas_realizadas) * 1000) / 10 : null;

  const total_cortes = cortesFilt.length;
  const valor_cortado = cortesFilt.reduce((a, c) => a + (c.valor_cortado || 0), 0);

  const total_clientes_novos = clientesNovos.length;

  // Meta geral (soma de todas as metas ativas no período)
  const metasPeriodo = metas.filter(m => m.periodo_inicio <= fim && m.periodo_fim >= inicio);
  const valor_meta_total = metasPeriodo.reduce((a, m) => a + (m.valor_meta || 0), 0);
  const percentual_meta_atingido = valor_meta_total > 0 ? Math.round((faturamento_total / valor_meta_total) * 1000) / 10 : null;

  // Vendedores ativos (que tiveram pelo menos 1 pedido no período)
  const vendedores_ativos = new Set(vendaFilt.map(p => p.vendedor_id).filter(Boolean)).size;

  // Montar resposta com nomes normalizados
  const indicadoresRaw = {
    'Faturamento Total': faturamento_total || null,
    'Total de Pedidos': total_pedidos || null,
    'Ticket Médio': ticket_medio,
    'Clientes Ativos': clientes_ativos || null,
    'Total Itens Vendidos': total_itens_vendidos || null,
    'Valor Trocas': valor_trocas || null,
    'Total Trocas': total_trocas || null,
    'Percentual Trocas': percentual_trocas,
    'Valor Bonificações': valor_bonificacoes || null,
    'Total Bonificações': total_bonificacoes || null,
    'Percentual Bonificações': percentual_bonificacoes,
    'Total Visitas': total_visitas || null,
    'Visitas Realizadas': visitas_realizadas || null,
    'Taxa Sucesso Visitas': taxa_sucesso_visitas,
    'Taxa de Conversão': taxa_de_conversao,
    'Total Cortes': total_cortes || null,
    'Valor Cortado': valor_cortado || null,
    'Clientes Novos': total_clientes_novos || null,
    'Vendedores Ativos': vendedores_ativos || null,
    'Valor Meta Total': valor_meta_total || null,
    'Percentual Meta Atingido': percentual_meta_atingido
  };

  const indicadores = {};
  for (const [nome, valor] of Object.entries(indicadoresRaw)) {
    indicadores[normalizar(nome)] = valor;
  }

  return Response.json({
    setor: 'comercial',
    mes,
    ano,
    periodo: { inicio, fim },
    indicadores
  });
});