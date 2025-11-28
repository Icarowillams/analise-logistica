function PedidosTab() {
  const [dates, setDates] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [expandedOrders, setExpandedOrders] = useState([]);

  // Buscar vendas no período
  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ['vendas_pedidos', dates.start, dates.end],
    queryFn: () => base44.entities.Venda.filter({
      data: { '$gte': dates.start, '$lte': dates.end }
    }, { limit: 2000, sort: { data: -1 } }) 
  });

  const pedidos = useMemo(() => {
    const agrupado = {};
    
    vendas.forEach(venda => {
      const numPedido = venda.numero_pedido || `S/N-${venda.data}-${venda.cliente_id}`;
      
      if (!agrupado[numPedido]) {
        agrupado[numPedido] = {
          numero_pedido: numPedido,
          data: venda.data,
          cod_cliente: '', // Need to fetch this or store it. Venda entity doesn't have cod_cliente directly, but we can infer or fetch. 
          // Actually I don't have cod_cliente on Venda, only cliente_nome and id.
          // I should probably populate cod_cliente in the entity if needed, or just use nome.
          // The user asked for "cod". I'll try to find it if I have the full client list in context or if I can join.
          // Since I can't join easily here without fetching all clients again, I'll check if I have clients in cache or just show Name for now.
          // Wait, the previous tool calls had access to `clientes` list. I should probably fetch clients here too to map ID to Code.
          cliente_id: venda.cliente_id,
          cliente_nome: venda.cliente_nome,
          itens: [],
          total_qtd: 0,
          total_valor: 0
        };
      }
      
      agrupado[numPedido].itens.push(venda);
      agrupado[numPedido].total_qtd += (venda.quantidade || 0);
      agrupado[numPedido].total_valor += (venda.valor_total || 0);
    });

    return Object.values(agrupado);
  }, [vendas]);

  // Fetch clients to get the Code
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes_lookup'], queryFn: () => base44.entities.Cliente.list() });
  
  const getClienteCode = (id) => {
    const c = clientes.find(cli => cli.id === id);
    return c ? c.codigo : 'N/A';
  };

  const toggleOrder = (orderId) => {
    setExpandedOrders(prev => 
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div>
              <Label>Data Inicial</Label>
              <Input 
                type="date" 
                value={dates.start} 
                onChange={e => setDates(d => ({ ...d, start: e.target.value }))} 
              />
            </div>
            <div>
              <Label>Data Final</Label>
              <Input 
                type="date" 
                value={dates.end} 
                onChange={e => setDates(d => ({ ...d, end: e.target.value }))} 
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" /> Pedidos Importados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Num Pedido</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Cod</TableHead>
                    <TableHead>Nome Fantasia</TableHead>
                    <TableHead className="text-right">Qtd Liq</TableHead>
                    <TableHead className="text-right">Valor Liq</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidos.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-500">Nenhum pedido encontrado no período</TableCell></TableRow>
                  ) : (
                    pedidos.map((pedido) => (
                      <React.Fragment key={pedido.numero_pedido}>
                        <TableRow className="hover:bg-slate-50 cursor-pointer" onClick={() => toggleOrder(pedido.numero_pedido)}>
                          <TableCell>
                            {expandedOrders.includes(pedido.numero_pedido) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{pedido.numero_pedido}</TableCell>
                          <TableCell>{format(parseISO(pedido.data), 'dd/MM/yyyy')}</TableCell>
                          <TableCell className="font-mono text-xs">{getClienteCode(pedido.cliente_id)}</TableCell>
                          <TableCell>{pedido.cliente_nome}</TableCell>
                          <TableCell className="text-right">{pedido.total_qtd}</TableCell>
                          <TableCell className="text-right font-semibold text-emerald-700">
                            {pedido.total_valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </TableCell>
                        </TableRow>
                        {expandedOrders.includes(pedido.numero_pedido) && (
                          <TableRow className="bg-slate-50/50">
                            <TableCell colSpan={7} className="p-0">
                              <div className="p-4 pl-12 border-b">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-slate-100/50">
                                      <TableHead>Produto</TableHead>
                                      <TableHead className="text-right">Qtd Liq</TableHead>
                                      <TableHead className="text-right">Valor Liq</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {pedido.itens.map((item, idx) => (
                                      <TableRow key={idx} className="border-0">
                                        <TableCell className="py-2">{item.produto_nome}</TableCell>
                                        <TableCell className="text-right py-2">{item.quantidade}</TableCell>
                                        <TableCell className="text-right py-2">
                                          {item.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}