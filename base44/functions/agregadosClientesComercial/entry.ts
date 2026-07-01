import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Agrega clientes no período: ranking de compras, positivação (compraram x sem compra)
// e distribuição por cidade/vendedor/rota. Tudo no servidor para aguentar milhares de
// registros. Cancelados são ignorados. "Sem compra" = cliente ATIVO sem nenhuma NF
// de venda (comissionavel) no espelho de faturamento (fonte Omie) no período.
//
// FONTE DE VALOR: EspelhoFaturamentoNF (comissionavel=true, valor_venda real do Omie).
// NUNCA Pedido.valor_total local.
//
// payload: { inicio?, fim?, vendedor_id?, cidade?, rota_id? }
// retorna: { kpis, ranking, sem_compra, por_cidade, por_vendedor, por_rota }

// Tira prefixo "[NNNNN] " do nome fantasia
function limparNome(s) {
  return String(s || '').replace(/^\[\d+\]\s*/, '').trim();
}

async function listarTudo(entidade, query, ordem) {
  const out = [];
  let skip = 0;
  const lote = 500;
  while (true) {
    const page = await entidade.filter(query, ordem, lote, skip);
    out.push(...page);
    if (page.length < lote) break;
    skip += lote;
    if (skip > 100000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { inicio = '', fim = '', vendedor_id = '', cidade = '', rota_id = '' } = body;

    // Clientes ativos
    const clientes = await listarTudo(base44.asServiceRole.entities.Cliente, { status: 'ativo' }, '-created_date');
    const vendedores = await base44.asServiceRole.entities.Vendedor.list('nome', 5000);
    const rotas = await base44.asServiceRole.entities.Rota.list('-created_date', 5000).catch(() => []);
    const nomeVend = new Map(vendedores.map(v => [v.id, v.nome]));
    const nomeRota = new Map(rotas.map(r => [r.id, r.nome || r.descricao || r.codigo || r.id]));

    // Aplica filtros opcionais de segmentação aos clientes considerados
    const clientesFiltrados = clientes.filter(c => {
      if (vendedor_id && c.vendedor_id !== vendedor_id) return false;
      if (cidade && (c.cidade || '') !== cidade) return false;
      if (rota_id && c.rota_id !== rota_id) return false;
      return true;
    });
    const clientesById = new Map(clientesFiltrados.map(c => [c.id, c]));

    // ESPPELHO DE FATURAMENTO (fonte Omie) — filtrado no banco por data_emissao + cancelada=false.
    // Paginação real (lote 500, skip crescente, break quando page<lote). NUNCA corta silenciosamente.
    const queryEspelho = { cancelada: false };
    if (inicio) queryEspelho.data_emissao = { ...queryEspelho.data_emissao, $gte: inicio };
    if (fim) queryEspelho.data_emissao = { ...queryEspelho.data_emissao, $lte: fim };
    const nfsRaw = await listarTudo(base44.asServiceRole.entities.EspelhoFaturamentoNF, queryEspelho, '-data_emissao');

    // De-dup por id (segurança contra duplicação) + só comissionável (venda real do Omie)
    const seenNf = new Set();
    const nfs = nfsRaw.filter(n => {
      if (!n.id || seenNf.has(n.id)) return false;
      seenNf.add(n.id);
      return n.comissionavel === true;
    });

    // Agrega compras por cliente (só clientes dentro do filtro de segmentação)
    // Valor = valor_venda (real do Omie). Pedidos = qtd de NFs (unidade do espelho).
    const comprasPorCliente = new Map(); // cliente_id -> { valor, pedidos }
    nfs.forEach(n => {
      if (!n.cliente_id || !clientesById.has(n.cliente_id)) return;
      const r = comprasPorCliente.get(n.cliente_id) || { valor: 0, pedidos: 0 };
      r.valor += n.valor_venda || 0;
      r.pedidos += 1;
      comprasPorCliente.set(n.cliente_id, r);
    });

    const nomeCliente = (c) => limparNome(c.nome_fantasia) || c.razao_social || c.codigo_interno || c.id;

    // Ranking — clientes que compraram, ordenado por R$
    const ranking = Array.from(comprasPorCliente.entries()).map(([id, r]) => {
      const c = clientesById.get(id);
      return {
        cliente_id: id,
        nome: nomeCliente(c),
        cidade: c.cidade || '-',
        vendedor_nome: nomeVend.get(c.vendedor_id) || '-',
        valor: r.valor,
        pedidos: r.pedidos,
        ticket: r.pedidos > 0 ? r.valor / r.pedidos : 0
      };
    }).sort((a, b) => b.valor - a.valor);

    // Sem compra — ativos no filtro que não aparecem em comprasPorCliente
    const sem_compra = clientesFiltrados
      .filter(c => !comprasPorCliente.has(c.id))
      .map(c => ({
        cliente_id: c.id,
        nome: nomeCliente(c),
        cidade: c.cidade || '-',
        vendedor_nome: nomeVend.get(c.vendedor_id) || '-',
        rota_nome: nomeRota.get(c.rota_id) || '-'
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    // KPIs
    const faturamento = ranking.reduce((s, r) => s + r.valor, 0);
    const totalPedidos = ranking.reduce((s, r) => s + r.pedidos, 0);
    const kpis = {
      ativos: clientesFiltrados.length,
      positivados: comprasPorCliente.size,
      sem_compra: sem_compra.length,
      faturamento,
      ticket_medio: totalPedidos > 0 ? faturamento / totalPedidos : 0,
      total_pedidos: totalPedidos
    };

    // Distribuição — só dos clientes que compraram, por cidade/vendedor/rota
    const distribuir = (campoNome) => {
      const m = new Map();
      ranking.forEach(r => {
        const c = clientesById.get(r.cliente_id);
        let chave;
        if (campoNome === 'cidade') chave = c.cidade || 'Sem cidade';
        else if (campoNome === 'vendedor') chave = nomeVend.get(c.vendedor_id) || 'Sem vendedor';
        else chave = nomeRota.get(c.rota_id) || 'Sem rota';
        const acc = m.get(chave) || { nome: chave, clientes: 0, valor: 0, pedidos: 0 };
        acc.clientes += 1;
        acc.valor += r.valor;
        acc.pedidos += r.pedidos;
        m.set(chave, acc);
      });
      return Array.from(m.values()).sort((a, b) => b.clientes - a.clientes);
    };

    return Response.json({
      kpis,
      ranking,
      sem_compra,
      por_cidade: distribuir('cidade'),
      por_vendedor: distribuir('vendedor'),
      por_rota: distribuir('rota'),
      periodo: { inicio, fim }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});