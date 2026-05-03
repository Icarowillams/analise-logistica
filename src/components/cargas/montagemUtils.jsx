export const formatCurrency = (value) =>
  `R$ ${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

export const qtdPacotesPedido = (pedido) =>
  (pedido.produtos || []).reduce((s, pr) => s + (Number(pr.quantidade) || 0), 0);

export const getPedidoBusca = (pedido) => [
  pedido.nome_cliente,
  pedido.nome_fantasia,
  pedido.numero_pedido,
  pedido.codigo_cliente_cod,
  pedido.cidade,
  pedido.rota_nome,
  pedido.vendedor_nome,
  pedido.observacoes,
  ...(pedido.produtos || []).flatMap(p => [p.codigo_produto, p.descricao])
].filter(Boolean).join(' ').toLowerCase();

export const filtrarPedidosMontagem = (pedidos, filtros, selecionados) => {
  const texto = (filtros.texto || '').trim().toLowerCase();
  const min = filtros.valorMin === '' ? null : Number(filtros.valorMin);
  const max = filtros.valorMax === '' ? null : Number(filtros.valorMax);

  return pedidos.filter(p => {
    if (filtros.apenasSelecionados && !selecionados.includes(p.codigo_pedido)) return false;
    if (filtros.tipo !== '__all__') {
      const tipo = p.tipo === 'troca' ? 'troca' : 'venda';
      if (tipo !== filtros.tipo) return false;
    }
    if (filtros.rota !== '__all__' && (p.rota_nome || 'Sem Rota') !== filtros.rota) return false;
    if (filtros.cidade !== '__all__' && (p.cidade || 'Sem Cidade') !== filtros.cidade) return false;
    if (filtros.vendedor !== '__all__' && (p.vendedor_nome || 'Sem Vendedor') !== filtros.vendedor) return false;
    if (min !== null && Number(p.valor_total_pedido || 0) < min) return false;
    if (max !== null && Number(p.valor_total_pedido || 0) > max) return false;
    if (texto && !getPedidoBusca(p).includes(texto)) return false;
    return true;
  });
};

export const getOpcoesMontagem = (pedidos) => ({
  rotas: [...new Set(pedidos.map(p => p.rota_nome || 'Sem Rota'))].sort(),
  cidades: [...new Set(pedidos.map(p => p.cidade || 'Sem Cidade'))].sort(),
  vendedores: [...new Set(pedidos.map(p => p.vendedor_nome || 'Sem Vendedor'))].sort()
});