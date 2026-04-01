export const filtrosIniciaisDashboardVendas = {
  vendedor: 'todos',
  supervisor: 'todos',
  dataInicio: '',
  dataFim: '',
  segmento: 'todos',
  rota: 'todos',
  numPedido: '',
  busca: '',
  rede: 'todos',
  produto: 'todos'
};

export function filtrarVendasDashboard(vendasPermitidas, filtros, vendedoresAll, clientes) {
  return vendasPermitidas.filter(v => {
    if (filtros.dataInicio && v.data < filtros.dataInicio) return false;
    if (filtros.dataFim && v.data > filtros.dataFim) return false;
    if (filtros.vendedor !== 'todos' && v.vendedor_id !== filtros.vendedor) return false;
    if (filtros.supervisor !== 'todos') {
      const vendedor = vendedoresAll.find(vd => vd.id === v.vendedor_id);
      if (!vendedor || vendedor.supervisor_id !== filtros.supervisor) return false;
    }
    if (filtros.produto !== 'todos' && v.produto_id !== filtros.produto) return false;
    if (filtros.numPedido && !v._pedido_numero?.includes(filtros.numPedido)) return false;
    if (filtros.segmento !== 'todos' || filtros.rede !== 'todos' || filtros.rota !== 'todos') {
      const cliente = clientes.find(c => c.id === v.cliente_id);
      if (!cliente) return false;
      if (filtros.segmento !== 'todos' && cliente.segmento_id !== filtros.segmento) return false;
      if (filtros.rede !== 'todos' && cliente.rede_id !== filtros.rede) return false;
      if (filtros.rota !== 'todos' && cliente.rota_id !== filtros.rota) return false;
    }
    if (filtros.busca) {
      const termo = filtros.busca.toLowerCase();
      const match = v.cliente_nome?.toLowerCase().includes(termo) ||
        v.produto_nome?.toLowerCase().includes(termo) ||
        v.vendedor_nome?.toLowerCase().includes(termo) ||
        v._pedido_numero?.toLowerCase().includes(termo);
      if (!match) return false;
    }
    return true;
  });
}

export function calcularResumoVendas(vendas) {
  const quantidadeTotal = vendas.reduce((acc, v) => acc + (v.quantidade || 0), 0);
  const valorTotal = vendas.reduce((acc, v) => acc + (v.valor_total || 0), 0);
  const pedidosUnicos = new Set(vendas.map(v => v._pedido_id)).size;
  const clientesUnicos = new Set(vendas.filter(v => v.cliente_id).map(v => v.cliente_id)).size;
  const precoMedio = quantidadeTotal > 0 ? valorTotal / quantidadeTotal : 0;

  return {
    quantidadeTotal,
    valorTotal,
    pedidosUnicos,
    clientesUnicos,
    precoMedio
  };
}

export function calcularVariacao(valorX, valorY) {
  if (!valorY) return valorX > 0 ? 100 : 0;
  return ((valorX - valorY) / valorY) * 100;
}

export function agruparVendasPorVendedor(vendas) {
  const grouped = {};
  vendas.forEach(v => {
    const nome = v.vendedor_nome || 'Sem Vendedor';
    if (!grouped[nome]) grouped[nome] = { nome, qtd: 0, valor: 0 };
    grouped[nome].qtd += v.quantidade || 0;
    grouped[nome].valor += v.valor_total || 0;
  });
  return Object.values(grouped)
    .sort((a, b) => b.valor - a.valor)
    .map(item => ({ ...item, precoMedio: item.qtd > 0 ? item.valor / item.qtd : 0 }));
}

export function agruparVendasPorProduto(vendas, produtos) {
  const grouped = {};
  vendas.forEach(v => {
    const key = v.produto_id || 'sem-id';
    if (!grouped[key]) {
      const prod = produtos.find(p => p.id === key);
      grouped[key] = {
        codigo: prod?.codigo || v.produto_codigo || 'N/A',
        nome: v.produto_nome || 'Desconhecido',
        qtd: 0,
        valor: 0
      };
    }
    grouped[key].qtd += v.quantidade || 0;
    grouped[key].valor += v.valor_total || 0;
  });
  return Object.values(grouped)
    .sort((a, b) => b.valor - a.valor)
    .map(item => ({ ...item, precoMedio: item.qtd > 0 ? item.valor / item.qtd : 0 }));
}

export function agruparVendasPorCliente(vendas, clientes, produtos) {
  const grouped = {};
  vendas.forEach(v => {
    const cId = v.cliente_id || 'sem-id';
    if (!grouped[cId]) {
      const cli = clientes.find(c => c.id === cId);
      grouped[cId] = { id: cId, codigo: cli?.codigo || 'N/A', nome: v.cliente_nome || 'Desconhecido', qtdTotal: 0, valorTotal: 0, pedidos: {} };
    }
    grouped[cId].qtdTotal += v.quantidade || 0;
    grouped[cId].valorTotal += v.valor_total || 0;
    const numPed = v._pedido_numero || 'S/N';
    if (!grouped[cId].pedidos[numPed]) {
      grouped[cId].pedidos[numPed] = { numero: numPed, data: v.data, status: v._pedido_status || 'faturado', qtdTotal: 0, valorTotal: 0, itens: [] };
    }
    grouped[cId].pedidos[numPed].qtdTotal += v.quantidade || 0;
    grouped[cId].pedidos[numPed].valorTotal += v.valor_total || 0;
    const prod = produtos.find(p => p.id === v.produto_id);
    grouped[cId].pedidos[numPed].itens.push({
      codProduto: prod?.codigo || v.produto_codigo || 'N/A',
      nomeProduto: v.produto_nome || 'Desconhecido',
      qtd: v.quantidade || 0,
      valorUnitario: v.valor_unitario || 0,
      valorTotal: v.valor_total || 0
    });
  });
  return Object.values(grouped)
    .map(c => ({
      ...c,
      pedidos: Object.values(c.pedidos).map(p => ({ ...p, precoMedio: p.qtdTotal > 0 ? p.valorTotal / p.qtdTotal : 0 }))
    }))
    .sort((a, b) => b.valorTotal - a.valorTotal);
}