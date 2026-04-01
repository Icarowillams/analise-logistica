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