import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line
} from 'recharts';
import { ArrowLeftRight, Package, Users, ShoppingCart, UserCheck, Download, DollarSign, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import StatsCard from '@/components/ui/StatsCard';
import FiltrosDashboard from '@/components/DashboardTrocas/FiltrosDashboard';
import PedidoTab from '@/components/DashboardTrocas/PedidoTab';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { startOfMonth, endOfMonth, format } from 'date-fns';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#6366f1', '#a855f7', '#ec4899'];

function ClienteAccordion({ cliente }) {
  const [openCliente, setOpenCliente] = useState(false);
  const [openPedidos, setOpenPedidos] = useState({});

  const togglePedido = (numPedido) => {
    setOpenPedidos(prev => ({
      ...prev,
      [numPedido]: !prev[numPedido]
    }));
  };

  return (
    <Collapsible open={openCliente} onOpenChange={setOpenCliente}>
      <div className="border border-slate-200 rounded-lg bg-white hover:shadow-md transition-shadow">
        <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-slate-50">
          <div className="flex items-center gap-3 flex-1">
            {openCliente ? <ChevronDown className="w-4 h-4 text-slate-600" /> : <ChevronRight className="w-4 h-4 text-slate-600" />}
            <div className="text-left flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500">{cliente.codigo}</span>
                <span className="text-sm font-semibold text-slate-800">{cliente.nome}</span>
              </div>
              <div className="flex gap-4 mt-1 text-xs text-slate-600">
                <span>Qtd: <strong className="text-purple-700">{cliente.qtdTotal}</strong></span>
                <span>Valor: <strong className="text-purple-700">{cliente.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></span>
              </div>
            </div>
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-2 bg-slate-50">
            {cliente.pedidos.map((pedido, pIdx) => (
              <div key={pIdx} className="border border-slate-300 rounded-md bg-white">
                <button
                  onClick={() => togglePedido(pedido.numero)}
                  className="w-full p-3 flex items-center justify-between hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2 flex-1">
                    {openPedidos[pedido.numero] ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                    <div className="text-left flex-1">
                      <div className="text-xs font-semibold text-slate-700">Pedido: {pedido.numero}</div>
                      <div className="flex gap-3 mt-0.5 text-xs text-slate-600">
                        <span>Qtd: {pedido.qtdTotal}</span>
                        <span>Valor: {pedido.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                        <span>Médio: {pedido.precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                      </div>
                    </div>
                  </div>
                </button>
                
                {openPedidos[pedido.numero] && (
                  <div className="px-3 pb-3 space-y-1.5 bg-slate-50">
                    {pedido.itens.map((item, iIdx) => (
                      <div key={iIdx} className="p-2 bg-white rounded border border-slate-200 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-500">{item.codProduto}</span>
                            <span className="font-medium text-slate-700">{item.nomeProduto}</span>
                          </div>
                        </div>
                        <div className="flex gap-3 mt-1 text-slate-600">
                          <span>Qtd: <strong>{item.qtd}</strong></span>
                          <span>Unit: {item.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                          <span>Total: <strong className="text-red-600">{item.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default function DashboardTrocas() {
  const [filtros, setFiltros] = useState({
    vendedor: 'todos',
    supervisor: 'todos',
    dataInicio: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dataFim: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
    segmento: 'todos',
    rota: 'todos',
    numPedido: '',
    busca: '',
    rede: 'todos',
    produto: 'todos',
    motivo: 'todos'
  });
  const [buscaCliente, setBuscaCliente] = useState('');

  const { data: trocas = [], isLoading: lT } = useQuery({ 
    queryKey: ['trocas'], 
    queryFn: () => base44.entities.Troca.list('-data', 5000) 
  });
  const { data: vendas = [], isLoading: lV } = useQuery({ 
    queryKey: ['vendas'], 
    queryFn: () => base44.entities.Venda.list('-data', 5000) 
  });
  const { data: clientes = [] } = useQuery({ 
    queryKey: ['clientes'], 
    queryFn: () => base44.entities.Cliente.list() 
  });
  const { data: vendedores = [] } = useQuery({ 
    queryKey: ['vendedores'], 
    queryFn: () => base44.entities.Vendedor.list() 
  });
  const { data: produtos = [] } = useQuery({ 
    queryKey: ['produtos'], 
    queryFn: () => base44.entities.Produto.list() 
  });
  const { data: segmentos = [] } = useQuery({ 
    queryKey: ['segmentos'], 
    queryFn: () => base44.entities.Segmento.list() 
  });
  const { data: rotas = [] } = useQuery({ 
    queryKey: ['rotas'], 
    queryFn: () => base44.entities.Rota.list() 
  });
  const { data: redes = [] } = useQuery({ 
    queryKey: ['redes'], 
    queryFn: () => base44.entities.Rede.list() 
  });
  const { data: motivos = [] } = useQuery({ 
    queryKey: ['motivosTroca'], 
    queryFn: () => base44.entities.MotivoTroca.list() 
  });

  const isLoading = lT || lV;

  // Supervisores únicos
  const supervisores = useMemo(() => {
    const uniqueSup = new Map();
    vendedores.forEach(v => {
      if (v.supervisor_id) {
        const sup = vendedores.find(s => s.id === v.supervisor_id);
        if (sup) uniqueSup.set(sup.id, sup);
      }
    });
    return Array.from(uniqueSup.values());
  }, [vendedores]);

  // Trocas Filtradas
  const trocasFiltradas = useMemo(() => {
    return trocas.filter(t => {
      // Filtro de data
      if (filtros.dataInicio && t.data < filtros.dataInicio) return false;
      if (filtros.dataFim && t.data > filtros.dataFim) return false;

      // Filtro de vendedor
      if (filtros.vendedor !== 'todos' && t.vendedor_id !== filtros.vendedor) return false;

      // Filtro de supervisor
      if (filtros.supervisor !== 'todos') {
        const vendedor = vendedores.find(v => v.id === t.vendedor_id);
        if (!vendedor || vendedor.supervisor_id !== filtros.supervisor) return false;
      }

      // Filtro de produto
      if (filtros.produto !== 'todos' && t.produto_original_id !== filtros.produto) return false;

      // Filtro de motivo
      if (filtros.motivo !== 'todos' && t.motivo_id !== filtros.motivo) return false;

      // Filtro de número de pedido (busca em observações ou venda_original_id)
      if (filtros.numPedido) {
        const temPedido = t.observacoes?.includes(filtros.numPedido) || 
                         t.venda_original_id?.includes(filtros.numPedido);
        if (!temPedido) return false;
      }

      // Filtro por cliente para pegar segmento, rede, rota
      if (filtros.segmento !== 'todos' || filtros.rede !== 'todos' || filtros.rota !== 'todos') {
        const cliente = clientes.find(c => c.id === t.cliente_id);
        if (!cliente) return false;
        
        if (filtros.segmento !== 'todos' && cliente.segmento_id !== filtros.segmento) return false;
        if (filtros.rede !== 'todos' && cliente.rede_id !== filtros.rede) return false;
        if (filtros.rota !== 'todos' && cliente.rota_id !== filtros.rota) return false;
      }

      // Busca geral
      if (filtros.busca) {
        const termo = filtros.busca.toLowerCase();
        const match = 
          t.cliente_nome?.toLowerCase().includes(termo) ||
          t.produto_original_nome?.toLowerCase().includes(termo) ||
          t.vendedor_nome?.toLowerCase().includes(termo) ||
          t.motivo_descricao?.toLowerCase().includes(termo) ||
          t.observacoes?.toLowerCase().includes(termo);
        if (!match) return false;
      }

      return true;
    });
  }, [trocas, filtros, vendedores, clientes]);

  // Métricas
  const quantidadeTotal = useMemo(() => {
    return trocasFiltradas.reduce((acc, t) => acc + (t.quantidade || 0), 0);
  }, [trocasFiltradas]);

  const valorTotal = useMemo(() => {
    let total = 0;
    trocasFiltradas.forEach(t => {
      // Buscar valor do produto nas vendas
      const venda = vendas.find(v => 
        v.produto_id === t.produto_original_id && 
        v.cliente_id === t.cliente_id &&
        Math.abs(new Date(v.data) - new Date(t.data)) < 7 * 24 * 60 * 60 * 1000 // 7 dias
      );
      const valorUnit = venda?.valor_unitario || 0;
      total += (t.quantidade || 0) * valorUnit;
    });
    return total;
  }, [trocasFiltradas, vendas]);

  const pedidosUnicos = useMemo(() => {
    const pedidos = new Set();
    trocasFiltradas.forEach(t => {
      if (t.venda_original_id) pedidos.add(t.venda_original_id);
      // Extrair número de pedido das observações
      const match = t.observacoes?.match(/Pedido:\s*(\S+)/);
      if (match) pedidos.add(match[1]);
    });
    return pedidos.size;
  }, [trocasFiltradas]);

  const clientesUnicos = useMemo(() => {
    const clientesSet = new Set();
    trocasFiltradas.forEach(t => {
      if (t.cliente_id) clientesSet.add(t.cliente_id);
    });
    return clientesSet.size;
  }, [trocasFiltradas]);

  // Preço Médio do Período
  const precoMedio = useMemo(() => {
    if (quantidadeTotal === 0) return 0;
    return valorTotal / quantidadeTotal;
  }, [valorTotal, quantidadeTotal]);

  // Trocas por Vendedor
  const trocasPorVendedor = useMemo(() => {
    const grouped = {};
    trocasFiltradas.forEach(t => {
      const nome = t.vendedor_nome || 'Sem Vendedor';
      if (!grouped[nome]) {
        grouped[nome] = { qtd: 0, valor: 0 };
      }
      const venda = vendas.find(v => 
        v.produto_id === t.produto_original_id && 
        v.cliente_id === t.cliente_id &&
        Math.abs(new Date(v.data) - new Date(t.data)) < 7 * 24 * 60 * 60 * 1000
      );
      const valorUnit = venda?.valor_unitario || 0;
      grouped[nome].qtd += t.quantidade || 0;
      grouped[nome].valor += (t.quantidade || 0) * valorUnit;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b.qtd - a.qtd)
      .map(([nome, data]) => ({ nome, ...data }));
  }, [trocasFiltradas, vendas]);

  // Trocas por Produto
  const trocasPorProduto = useMemo(() => {
    const grouped = {};
    trocasFiltradas.forEach(t => {
      const produtoId = t.produto_original_id || 'sem-id';
      const nome = t.produto_original_nome || 'Desconhecido';
      
      if (!grouped[produtoId]) {
        const produto = produtos.find(p => p.id === produtoId);
        grouped[produtoId] = { 
          codigo: produto?.codigo || 'N/A',
          nome, 
          qtd: 0, 
          valor: 0 
        };
      }
      const venda = vendas.find(v => 
        v.produto_id === t.produto_original_id && 
        v.cliente_id === t.cliente_id &&
        Math.abs(new Date(v.data) - new Date(t.data)) < 7 * 24 * 60 * 60 * 1000
      );
      const valorUnit = venda?.valor_unitario || 0;
      grouped[produtoId].qtd += t.quantidade || 0;
      grouped[produtoId].valor += (t.quantidade || 0) * valorUnit;
    });
    return Object.values(grouped)
      .sort((a, b) => b.qtd - a.qtd)
      .map(data => ({ 
        ...data,
        precoMedio: data.qtd > 0 ? data.valor / data.qtd : 0
      }));
  }, [trocasFiltradas, vendas, produtos]);

  // Trocas por Cliente com detalhes
  const trocasPorCliente = useMemo(() => {
    const grouped = {};
    
    trocasFiltradas.forEach(t => {
      const clienteId = t.cliente_id || 'sem-id';
      const clienteNome = t.cliente_nome || 'Desconhecido';
      
      if (!grouped[clienteId]) {
        const cliente = clientes.find(c => c.id === clienteId);
        grouped[clienteId] = {
          id: clienteId,
          codigo: cliente?.codigo || 'N/A',
          nome: clienteNome,
          qtdTotal: 0,
          valorTotal: 0,
          pedidos: {}
        };
      }
      
      const venda = vendas.find(v => 
        v.produto_id === t.produto_original_id && 
        v.cliente_id === t.cliente_id &&
        Math.abs(new Date(v.data) - new Date(t.data)) < 7 * 24 * 60 * 60 * 1000
      );
      const valorUnit = venda?.valor_unitario || 0;
      const valorItem = (t.quantidade || 0) * valorUnit;
      
      grouped[clienteId].qtdTotal += t.quantidade || 0;
      grouped[clienteId].valorTotal += valorItem;
      
      // Extrair número do pedido
      const match = t.observacoes?.match(/Pedido:\s*(\S+)/);
      const numPedido = match ? match[1] : (t.venda_original_id || 'S/N');
      
      if (!grouped[clienteId].pedidos[numPedido]) {
        grouped[clienteId].pedidos[numPedido] = {
          numero: numPedido,
          qtdTotal: 0,
          valorTotal: 0,
          itens: []
        };
      }
      
      grouped[clienteId].pedidos[numPedido].qtdTotal += t.quantidade || 0;
      grouped[clienteId].pedidos[numPedido].valorTotal += valorItem;
      
      const produto = produtos.find(p => p.id === t.produto_original_id);
      grouped[clienteId].pedidos[numPedido].itens.push({
        codProduto: produto?.codigo || 'N/A',
        nomeProduto: t.produto_original_nome || 'Desconhecido',
        qtd: t.quantidade || 0,
        valorUnitario: valorUnit,
        valorTotal: valorItem
      });
    });
    
    return Object.values(grouped)
      .map(c => ({
        ...c,
        pedidos: Object.values(c.pedidos).map(p => ({
          ...p,
          precoMedio: p.qtdTotal > 0 ? p.valorTotal / p.qtdTotal : 0
        }))
      }))
      .sort((a, b) => b.qtdTotal - a.qtdTotal);
  }, [trocasFiltradas, clientes, vendas, produtos]);
  
  // Filtrar clientes pela busca
  const clientesFiltrados = useMemo(() => {
    if (!buscaCliente.trim()) return trocasPorCliente;
    const termo = buscaCliente.toLowerCase();
    return trocasPorCliente.filter(c => 
      c.codigo.toLowerCase().includes(termo) ||
      c.nome.toLowerCase().includes(termo)
    );
  }, [trocasPorCliente, buscaCliente]);

  // Evolução Mensal
  const evolucaoMensal = useMemo(() => {
    const grouped = {};
    trocasFiltradas.forEach(t => {
      if (!t.data) return;
      const mes = t.data.substring(0, 7);
      if (!grouped[mes]) grouped[mes] = 0;
      grouped[mes] += t.quantidade || 0;
    });
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, qtd]) => ({
        mes: mes.substring(5) + '/' + mes.substring(0, 4),
        qtd
      }));
  }, [trocasFiltradas]);

  // Trocas por Dia da Semana
  const trocasPorDiaSemana = useMemo(() => {
    const dias = {
      'Segunda': 0,
      'Terça': 0,
      'Quarta': 0,
      'Quinta': 0,
      'Sexta': 0,
      'Sábado': 0
    };
    
    trocasFiltradas.forEach(t => {
      if (!t.data) return;
      const date = new Date(t.data + 'T00:00:00');
      const diaSemana = date.getDay();
      
      const nomeDia = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][diaSemana - 1];
      if (nomeDia && dias[nomeDia] !== undefined) {
        dias[nomeDia] += t.quantidade || 0;
      }
    });

    return Object.entries(dias).map(([dia, qtd]) => ({ dia, qtd }));
  }, [trocasFiltradas]);

  const exportarDashboard = async () => {
    const element = document.getElementById('dashboard-content');
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
    
    pdf.save(`Dashboard_Trocas_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg">
            <ArrowLeftRight className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard de Trocas</h1>
            <p className="text-slate-500">Análise completa de trocas de produtos</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <FiltrosDashboard
        filtros={filtros}
        setFiltros={setFiltros}
        vendedores={vendedores}
        supervisores={supervisores}
        segmentos={segmentos}
        rotas={rotas}
        redes={redes}
        produtos={produtos}
        motivos={motivos}
      />

      {/* Tabs */}
      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="pedido">Consultar Pedido</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <div className="flex justify-end">
            <Button onClick={exportarDashboard} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Exportar Dashboard
            </Button>
          </div>

          <div id="dashboard-content" className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <StatsCard
                title="Quantidade Total"
                value={quantidadeTotal.toLocaleString('pt-BR')}
                subtitle="produtos trocados"
                icon={Package}
                gradient="from-orange-500 to-red-600"
              />
              <StatsCard
                title="Valor Total"
                value={valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                subtitle="em trocas"
                icon={ShoppingCart}
                gradient="from-red-500 to-pink-600"
              />
              <StatsCard
                title="Preço Médio"
                value={precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                subtitle="do período"
                icon={DollarSign}
                gradient="from-emerald-500 to-teal-600"
              />
              <StatsCard
                title="Pedidos de Troca"
                value={pedidosUnicos}
                subtitle="solicitações únicas"
                icon={ArrowLeftRight}
                gradient="from-amber-500 to-orange-500"
              />
              <StatsCard
                title="Clientes com Trocas"
                value={clientesUnicos}
                subtitle="clientes distintos"
                icon={UserCheck}
                gradient="from-purple-500 to-pink-600"
              />
            </div>

            {/* Listas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Vendedor */}
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-base">Total por Vendedor</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {trocasPorVendedor.map((v, idx) => (
                      <div key={idx} className="p-3 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border border-slate-200">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-sm font-semibold text-slate-800 truncate flex-1">{v.nome}</span>
                          <Badge className="bg-red-100 text-red-700 text-xs ml-2">{v.qtd}</Badge>
                        </div>
                        <div className="text-xs text-slate-600">
                          Valor: {v.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Produto */}
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-base">Total por Produto</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[500px] overflow-y-auto pr-2">
                    <div className="space-y-2">
                      {trocasPorProduto.map((p, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 p-2 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg border border-orange-200 text-xs">
                          <div className="col-span-2 font-mono text-orange-800 font-semibold truncate">{p.codigo}</div>
                          <div className="col-span-4 font-medium text-orange-900 truncate" title={p.nome}>
                            {p.nome.length > 25 ? p.nome.substring(0, 25) + '...' : p.nome}
                          </div>
                          <div className="col-span-2 text-right">
                            <Badge className="bg-orange-200 text-orange-800 text-xs">{p.qtd}</Badge>
                          </div>
                          <div className="col-span-2 text-right text-orange-700 font-semibold">
                            {p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </div>
                          <div className="col-span-2 text-right text-orange-600">
                            {p.precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-orange-200 grid grid-cols-12 gap-2 text-xs font-semibold text-orange-800">
                    <div className="col-span-2">Cód</div>
                    <div className="col-span-4">Descrição</div>
                    <div className="col-span-2 text-right">Qtd</div>
                    <div className="col-span-2 text-right">Valor Total</div>
                    <div className="col-span-2 text-right">Preço Médio</div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Cliente com Accordion */}
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Total por Cliente</CardTitle>
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-slate-400" />
                    <Input
                      placeholder="Buscar cliente..."
                      value={buscaCliente}
                      onChange={(e) => setBuscaCliente(e.target.value)}
                      className="w-64 h-9"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
                  {clientesFiltrados.map((cliente, idx) => (
                    <ClienteAccordion key={idx} cliente={cliente} />
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Gráficos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Evolução Mensal */}
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle>Evolução Mensal de Trocas</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={evolucaoMensal}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 12 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} />
                      <Line 
                        type="monotone" 
                        dataKey="qtd" 
                        stroke="#ef4444" 
                        strokeWidth={3} 
                        dot={{ fill: '#ef4444', r: 5 }}
                        label={{ position: 'top', fill: '#ef4444', fontSize: 12, fontWeight: 600 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Por Dia da Semana */}
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle>Trocas por Dia da Semana</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={trocasPorDiaSemana}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="dia" tick={{ fill: '#64748b', fontSize: 12 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} />
                      <Bar 
                        dataKey="qtd" 
                        fill="#f97316" 
                        radius={[8, 8, 0, 0]}
                        label={{ position: 'top', fill: '#f97316', fontSize: 12, fontWeight: 600 }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pedido">
          <PedidoTab vendas={vendas} clientes={clientes} produtos={produtos} />
        </TabsContent>
      </Tabs>
    </div>
  );
}