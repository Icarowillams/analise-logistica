import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line
} from 'recharts';
import { ShoppingCart, Package, Users, UserCheck, Download, DollarSign, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import StatsCard from '@/components/ui/StatsCard';
import FiltrosDashboardVendas from '@/components/DashboardVendas/FiltrosDashboardVendas';
import ClienteVendaAccordion from '@/components/DashboardVendas/ClienteVendaAccordion';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ComparacaoPeriodosTab from '@/components/DashboardVendas/ComparacaoPeriodosTab';
import { filtrosIniciaisDashboardVendas, filtrarVendasDashboard } from '@/components/DashboardVendas/dashboardVendasUtils';

export default function DashboardPedidosVenda() {
  const [filtros, setFiltros] = useState({
    ...filtrosIniciaisDashboardVendas,
    dataInicio: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dataFim: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [filtrosComparacaoX, setFiltrosComparacaoX] = useState({
    ...filtrosIniciaisDashboardVendas,
    dataInicio: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dataFim: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [filtrosComparacaoY, setFiltrosComparacaoY] = useState({
    ...filtrosIniciaisDashboardVendas,
    dataInicio: format(startOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)), 'yyyy-MM-dd'),
    dataFim: format(endOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)), 'yyyy-MM-dd')
  });
  const [buscaCliente, setBuscaCliente] = useState('');

  // Buscar pedidos de venda faturados
  const { data: pedidosVendaFaturados = [], isLoading: lPV } = useQuery({
    queryKey: ['pedidos-venda-faturados'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'venda', status: 'faturado' })
  });

  const { data: pedidoItensVenda = [], isLoading: lPI } = useQuery({
    queryKey: ['pedido-itens-venda', pedidosVendaFaturados.map(p => p.id).join(',')],
    queryFn: async () => {
      if (pedidosVendaFaturados.length === 0) return [];
      const allItems = [];
      for (const pedido of pedidosVendaFaturados) {
        const itens = await base44.entities.PedidoItem.filter({ pedido_id: pedido.id });
        itens.forEach(item => allItems.push({ ...item, _pedido: pedido }));
      }
      return allItems;
    },
    enabled: pedidosVendaFaturados.length > 0
  });

  const { data: clientesAll = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: vendedoresAll = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });
  const { data: segmentos = [] } = useQuery({ queryKey: ['segmentos'], queryFn: () => base44.entities.Segmento.list() });
  const { data: rotas = [] } = useQuery({ queryKey: ['rotas'], queryFn: () => base44.entities.Rota.list() });
  const { data: redes = [] } = useQuery({ queryKey: ['redes'], queryFn: () => base44.entities.Rede.list() });

  const { filtrarClientes, filtrarPorCliente, vendedoresPermitidosIds } = useClientesPermissao();

  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);
  const vendedores = useMemo(() => {
    if (vendedoresPermitidosIds === null) return vendedoresAll;
    return vendedoresAll.filter(v => vendedoresPermitidosIds.has(v.id));
  }, [vendedoresAll, vendedoresPermitidosIds]);

  const isLoading = lPV || lPI;

  // Derivar linhas de venda a partir de pedidos faturados
  const vendasDerivadas = useMemo(() => {
    return pedidoItensVenda.map(item => {
      const pedido = item._pedido;
      const cliente = clientes.find(c => c.id === pedido.cliente_id);
      const vendedorCliente = vendedoresAll.find(v => v.id === cliente?.vendedor_id);
      return {
        id: item.id,
        cliente_id: pedido.cliente_id,
        cliente_nome: pedido.cliente_nome || pedido.cliente_nome_fantasia,
        vendedor_id: cliente?.vendedor_id || pedido.vendedor_id,
        vendedor_nome: vendedorCliente?.nome || pedido.vendedor_nome,
        produto_id: item.produto_id,
        produto_nome: item.produto_nome,
        produto_codigo: item.produto_codigo,
        quantidade: item.quantidade || 0,
        valor_unitario: item.valor_unitario || 0,
        valor_total: item.valor_total || ((item.quantidade || 0) * (item.valor_unitario || 0)),
        data: pedido.data_previsao_entrega || (pedido.created_date ? pedido.created_date.split('T')[0] : ''),
        _pedido_numero: pedido.numero_pedido || 'S/N',
        _pedido_status: pedido.status,
        _pedido_id: pedido.id
      };
    });
  }, [pedidoItensVenda, clientes, vendedoresAll]);

  const vendasPermitidas = useMemo(() => filtrarPorCliente(vendasDerivadas), [vendasDerivadas, filtrarPorCliente]);

  // Supervisores
  const supervisores = useMemo(() => {
    const uniqueSup = new Map();
    vendedores.forEach(v => {
      if (v.supervisor_id) {
        const sup = vendedoresAll.find(s => s.id === v.supervisor_id);
        if (sup) uniqueSup.set(sup.id, sup);
      }
    });
    return Array.from(uniqueSup.values());
  }, [vendedores, vendedoresAll]);

  // Vendas Filtradas
  const vendasFiltradas = useMemo(() => {
    return filtrarVendasDashboard(vendasPermitidas, filtros, vendedoresAll, clientes);
  }, [vendasPermitidas, filtros, vendedoresAll, clientes]);

  // KPIs
  const quantidadeTotal = useMemo(() => vendasFiltradas.reduce((acc, v) => acc + (v.quantidade || 0), 0), [vendasFiltradas]);
  const valorTotal = useMemo(() => vendasFiltradas.reduce((acc, v) => acc + (v.valor_total || 0), 0), [vendasFiltradas]);
  const precoMedio = useMemo(() => quantidadeTotal > 0 ? valorTotal / quantidadeTotal : 0, [valorTotal, quantidadeTotal]);
  const pedidosUnicos = useMemo(() => new Set(vendasFiltradas.map(v => v._pedido_id)).size, [vendasFiltradas]);
  const clientesUnicos = useMemo(() => new Set(vendasFiltradas.filter(v => v.cliente_id).map(v => v.cliente_id)).size, [vendasFiltradas]);

  // Por Vendedor
  const vendasPorVendedor = useMemo(() => {
    const grouped = {};
    vendasFiltradas.forEach(v => {
      const nome = v.vendedor_nome || 'Sem Vendedor';
      if (!grouped[nome]) grouped[nome] = { qtd: 0, valor: 0 };
      grouped[nome].qtd += v.quantidade || 0;
      grouped[nome].valor += v.valor_total || 0;
    });
    return Object.entries(grouped).sort(([, a], [, b]) => b.valor - a.valor)
      .map(([nome, data]) => ({ nome, ...data, precoMedio: data.qtd > 0 ? data.valor / data.qtd : 0 }));
  }, [vendasFiltradas]);

  // Por Produto
  const vendasPorProduto = useMemo(() => {
    const grouped = {};
    vendasFiltradas.forEach(v => {
      const key = v.produto_id || 'sem-id';
      if (!grouped[key]) {
        const prod = produtos.find(p => p.id === key);
        grouped[key] = { codigo: prod?.codigo || v.produto_codigo || 'N/A', nome: v.produto_nome || 'Desconhecido', qtd: 0, valor: 0 };
      }
      grouped[key].qtd += v.quantidade || 0;
      grouped[key].valor += v.valor_total || 0;
    });
    return Object.values(grouped).sort((a, b) => b.valor - a.valor)
      .map(d => ({ ...d, precoMedio: d.qtd > 0 ? d.valor / d.qtd : 0 }));
  }, [vendasFiltradas, produtos]);

  // Por Cliente
  const vendasPorCliente = useMemo(() => {
    const grouped = {};
    vendasFiltradas.forEach(v => {
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
    return Object.values(grouped).map(c => ({
      ...c,
      pedidos: Object.values(c.pedidos).map(p => ({ ...p, precoMedio: p.qtdTotal > 0 ? p.valorTotal / p.qtdTotal : 0 }))
    })).sort((a, b) => b.valorTotal - a.valorTotal);
  }, [vendasFiltradas, clientes, produtos]);

  const clientesFiltrados = useMemo(() => {
    if (!buscaCliente.trim()) return vendasPorCliente;
    const termo = buscaCliente.toLowerCase();
    return vendasPorCliente.filter(c => c.codigo.toLowerCase().includes(termo) || c.nome.toLowerCase().includes(termo));
  }, [vendasPorCliente, buscaCliente]);

  // Evolução Mensal
  const evolucaoMensal = useMemo(() => {
    const grouped = {};
    vendasFiltradas.forEach(v => {
      if (!v.data) return;
      const mes = v.data.substring(0, 7);
      if (!grouped[mes]) grouped[mes] = { qtd: 0, valor: 0 };
      grouped[mes].qtd += v.quantidade || 0;
      grouped[mes].valor += v.valor_total || 0;
    });
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, d]) => ({ mes: mes.substring(5) + '/' + mes.substring(0, 4), qtd: d.qtd, valor: d.valor }));
  }, [vendasFiltradas]);

  // Por Dia da Semana
  const vendasPorDiaSemana = useMemo(() => {
    const dias = { 'Segunda': 0, 'Terça': 0, 'Quarta': 0, 'Quinta': 0, 'Sexta': 0, 'Sábado': 0 };
    vendasFiltradas.forEach(v => {
      if (!v.data) return;
      const date = new Date(v.data + 'T00:00:00');
      const nomeDia = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][date.getDay() - 1];
      if (nomeDia && dias[nomeDia] !== undefined) dias[nomeDia] += v.valor_total || 0;
    });
    return Object.entries(dias).map(([dia, valor]) => ({ dia, valor }));
  }, [vendasFiltradas]);

  const exportarDashboard = async () => {
    const element = document.getElementById('dashboard-vendas-content');
    const canvas = await html2canvas(element, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgWidth = 210;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= 297;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= 297;
    }
    pdf.save(`Dashboard_Vendas_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <ShoppingCart className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard de Vendas</h1>
            <p className="text-slate-500">Análise de pedidos de venda faturados</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="atual" className="space-y-6">
        <TabsList className="h-auto w-full justify-start rounded-2xl bg-white p-1 shadow-sm border border-slate-200">
          <TabsTrigger value="atual" className="rounded-xl px-4 py-2">Dashboard atual</TabsTrigger>
          <TabsTrigger value="comparacao" className="rounded-xl px-4 py-2">Comparar períodos</TabsTrigger>
        </TabsList>

        <TabsContent value="atual" className="space-y-6">
          <FiltrosDashboardVendas
            filtros={filtros}
            setFiltros={setFiltros}
            vendedores={vendedores}
            supervisores={supervisores}
            segmentos={segmentos}
            rotas={rotas}
            redes={redes}
            produtos={produtos}
          />

          <div className="flex justify-end">
            <Button onClick={exportarDashboard} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Exportar Dashboard
            </Button>
          </div>

          <div id="dashboard-vendas-content" className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
          <StatsCard title="Quantidade Total" value={quantidadeTotal.toLocaleString('pt-BR')} subtitle="itens vendidos" icon={Package} gradient="from-blue-500 to-indigo-600" />
          <StatsCard title="Valor Total" value={valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} subtitle="em vendas" icon={DollarSign} gradient="from-emerald-500 to-teal-600" />
          <StatsCard title="Preço Médio" value={precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} subtitle="por item" icon={DollarSign} gradient="from-violet-500 to-purple-600" />
          <StatsCard title="Pedidos Faturados" value={pedidosUnicos} subtitle="pedidos únicos" icon={ShoppingCart} gradient="from-amber-500 to-orange-500" />
          <StatsCard title="Clientes Atendidos" value={clientesUnicos} subtitle="clientes distintos" icon={UserCheck} gradient="from-cyan-500 to-blue-500" />
        </div>

        {/* Listas Vendedor / Produto */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-0 shadow-lg">
            <CardHeader><CardTitle className="text-base">Total por Vendedor</CardTitle></CardHeader>
            <CardContent>
              <div className="mb-2 pb-2 border-b border-slate-200 grid grid-cols-12 gap-2 text-xs font-semibold text-slate-800 items-center">
                <div className="col-span-5">Nome</div>
                <div className="col-span-2 text-center">Qtd</div>
                <div className="col-span-3 text-right pr-1">Valor Total</div>
                <div className="col-span-2 text-right pr-1">Preço Médio</div>
              </div>
              <div className="max-h-[500px] overflow-y-auto pr-2 space-y-2">
                {vendasPorVendedor.map((v, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 p-2 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border border-slate-200 text-xs items-center">
                    <div className="col-span-5 font-medium text-slate-800 truncate" title={v.nome}>{v.nome}</div>
                    <div className="col-span-2 flex justify-center"><Badge className="bg-blue-100 text-blue-700 text-xs">{v.qtd}</Badge></div>
                    <div className="col-span-3 text-right text-slate-700 font-semibold pr-1">{v.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                    <div className="col-span-2 text-right text-slate-600 pr-1">{v.precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader><CardTitle className="text-base">Total por Produto</CardTitle></CardHeader>
            <CardContent>
              <div className="mb-2 pb-2 border-b border-blue-200 grid grid-cols-12 gap-2 text-xs font-semibold text-blue-800 items-center">
                <div className="col-span-1">Cód</div>
                <div className="col-span-5">Descrição</div>
                <div className="col-span-2 text-center">Qtd</div>
                <div className="col-span-2 text-right pr-1">Valor Total</div>
                <div className="col-span-2 text-right pr-1">Preço Médio</div>
              </div>
              <div className="max-h-[500px] overflow-y-auto pr-2 space-y-2">
                {vendasPorProduto.map((p, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 p-2 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 text-xs items-center">
                    <div className="col-span-1 font-mono text-blue-800 font-semibold truncate">{p.codigo}</div>
                    <div className="col-span-5 font-medium text-blue-900 truncate" title={p.nome}>{p.nome.length > 35 ? p.nome.substring(0, 35) + '...' : p.nome}</div>
                    <div className="col-span-2 flex justify-center"><Badge className="bg-blue-200 text-blue-800 text-xs">{p.qtd}</Badge></div>
                    <div className="col-span-2 text-right text-blue-700 font-semibold pr-1">{p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                    <div className="col-span-2 text-right text-blue-600 pr-1">{p.precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cliente Accordion */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Total por Cliente</CardTitle>
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" />
                <Input placeholder="Buscar cliente..." value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} className="w-64 h-9" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
              {clientesFiltrados.map((cliente, idx) => (
                <ClienteVendaAccordion key={idx} cliente={cliente} />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Gráficos */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-0 shadow-lg">
            <CardHeader><CardTitle>Evolução Mensal de Vendas (R$)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={evolucaoMensal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} formatter={(v) => [`R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Valor']} />
                  <Line type="monotone" dataKey="valor" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader><CardTitle>Vendas por Dia da Semana (R$)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={vendasPorDiaSemana}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="dia" tick={{ fill: '#64748b', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} formatter={(v) => [`R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Valor']} />
                  <Bar dataKey="valor" fill="#6366f1" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
          </div>
        </TabsContent>

        <TabsContent value="comparacao">
          <ComparacaoPeriodosTab
            filtrosX={filtrosComparacaoX}
            setFiltrosX={setFiltrosComparacaoX}
            filtrosY={filtrosComparacaoY}
            setFiltrosY={setFiltrosComparacaoY}
            vendasPermitidas={vendasPermitidas}
            vendedores={vendedores}
            vendedoresAll={vendedoresAll}
            supervisores={supervisores}
            segmentos={segmentos}
            rotas={rotas}
            redes={redes}
            produtos={produtos}
            clientes={clientes}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}