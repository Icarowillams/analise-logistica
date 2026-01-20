import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';
import { User, TrendingUp, DollarSign, Package, ArrowLeftRight, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StatsCard from '@/components/ui/StatsCard';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardVendedor() {
  const [vendedorId, setVendedorId] = useState('');

  const { data: vendedoresAll = [], isLoading: lV } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: vendasAll = [], isLoading: lVe } = useQuery({ queryKey: ['vendas'], queryFn: () => base44.entities.Venda.list('-data', 5000) });
  const { data: trocasAll = [] } = useQuery({ queryKey: ['trocas'], queryFn: () => base44.entities.Troca.list('-data', 2000) });
  const { data: rotas = [] } = useQuery({ queryKey: ['rotas'], queryFn: () => base44.entities.Rota.list() });
  const { data: clientesAll = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });

  // Permissões de visibilidade de clientes
  const { filtrarClientes, filtrarPorCliente, filtrarPorVendedor, vendedoresPermitidosIds } = useClientesPermissao();

  // Dados filtrados por permissão
  const vendedores = useMemo(() => {
    if (vendedoresPermitidosIds === null) return vendedoresAll;
    return vendedoresAll.filter(v => vendedoresPermitidosIds.has(v.id));
  }, [vendedoresAll, vendedoresPermitidosIds]);
  const vendas = useMemo(() => filtrarPorCliente(vendasAll), [vendasAll, filtrarPorCliente]);
  const trocas = useMemo(() => filtrarPorCliente(trocasAll), [trocasAll, filtrarPorCliente]);
  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);

  const isLoading = lV || lVe;

  const vendedorSelecionado = vendedores.find(v => v.id === vendedorId);
  const vendasVendedor = vendas.filter(v => v.vendedor_id === vendedorId);
  const trocasVendedor = trocas.filter(t => t.vendedor_id === vendedorId);
  const rotasVendedor = rotas.filter(r => r.vendedor_id === vendedorId);

  // Métricas
  const totalVendas = vendasVendedor.reduce((sum, v) => sum + (v.valor_total || 0), 0);
  const qtdVendas = vendasVendedor.length;
  const ticketMedio = qtdVendas > 0 ? totalVendas / qtdVendas : 0;
  const qtdTrocas = trocasVendedor.length;

  // Histórico por mês (últimos 6 meses)
  const historicoMensal = React.useMemo(() => {
    const grouped = {};
    vendasVendedor.forEach(v => {
      if (!v.data) return;
      const month = v.data.substring(0, 7);
      if (!grouped[month]) grouped[month] = { valor: 0, qtd: 0 };
      grouped[month].valor += v.valor_total || 0;
      grouped[month].qtd += 1;
    });
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, data]) => ({
        mes: new Date(month + '-01').toLocaleDateString('pt-BR', { month: 'short' }),
        valor: data.valor,
        qtd: data.qtd
      }));
  }, [vendasVendedor]);

  // Top produtos do vendedor
  const topProdutos = React.useMemo(() => {
    const grouped = {};
    vendasVendedor.forEach(v => {
      const nome = v.produto_nome || 'Desconhecido';
      if (!grouped[nome]) grouped[nome] = 0;
      grouped[nome] += v.quantidade || 0;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([nome, qtd]) => ({ nome, qtd }));
  }, [vendasVendedor]);

  // Top clientes do vendedor
  const topClientes = React.useMemo(() => {
    const grouped = {};
    vendasVendedor.forEach(v => {
      const nome = v.cliente_nome || 'Desconhecido';
      if (!grouped[nome]) grouped[nome] = 0;
      grouped[nome] += v.valor_total || 0;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([nome, valor]) => ({ nome, valor }));
  }, [vendasVendedor]);

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
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <User className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard por Vendedor</h1>
            <p className="text-slate-500">Performance individual detalhada</p>
          </div>
        </div>
        <Select value={vendedorId} onValueChange={setVendedorId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Selecione um vendedor..." />
          </SelectTrigger>
          <SelectContent>
            {vendedores.filter(v => v.status === 'ativo').map(v => (
              <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!vendedorId ? (
        <Card className="border-2 border-dashed border-slate-200">
          <CardContent className="py-16 text-center">
            <User className="w-16 h-16 mx-auto text-slate-300 mb-4" />
            <p className="text-lg text-slate-500">Selecione um vendedor para visualizar suas métricas</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatsCard
              title="Total Vendido"
              value={`R$ ${totalVendas.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`}
              icon={DollarSign}
              gradient="from-emerald-500 to-teal-600"
            />
            <StatsCard
              title="Vendas Realizadas"
              value={qtdVendas}
              icon={Package}
              gradient="from-blue-500 to-indigo-600"
            />
            <StatsCard
              title="Ticket Médio"
              value={`R$ ${ticketMedio.toFixed(2)}`}
              icon={TrendingUp}
              gradient="from-purple-500 to-pink-600"
            />
            <StatsCard
              title="Trocas"
              value={qtdTrocas}
              icon={ArrowLeftRight}
              gradient="from-orange-500 to-amber-500"
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle>Histórico de Vendas</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={historicoMensal}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
                    <Tooltip 
                      formatter={(value) => [`R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Valor']}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}
                    />
                    <Line type="monotone" dataKey="valor" stroke="#6366f1" strokeWidth={3} dot={{ fill: '#6366f1', r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle>Top 5 Produtos Vendidos</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={topProdutos} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} />
                    <YAxis dataKey="nome" type="category" tick={{ fill: '#64748b', fontSize: 11 }} width={100} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} />
                    <Bar dataKey="qtd" fill="#8b5cf6" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Top Clientes e Rotas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Top 5 Clientes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topClientes.map((c, idx) => (
                    <div key={c.nome} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 font-semibold text-sm">
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-sm font-medium text-slate-700">{c.nome}</span>
                          <span className="text-sm font-semibold text-slate-900">R$ {c.valor.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</span>
                        </div>
                        <Progress value={(c.valor / (topClientes[0]?.valor || 1)) * 100} className="h-1.5" />
                      </div>
                    </div>
                  ))}
                  {topClientes.length === 0 && (
                    <p className="text-slate-500 text-center py-4">Nenhum cliente encontrado</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle>Rotas Atribuídas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {rotasVendedor.map(r => (
                    <div key={r.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div>
                        <p className="font-medium text-slate-800">{r.nome}</p>
                        <p className="text-sm text-slate-500">
                          {r.frequencia} • {r.dia_semana}
                        </p>
                      </div>
                      <Badge className={r.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                        {r.status}
                      </Badge>
                    </div>
                  ))}
                  {rotasVendedor.length === 0 && (
                    <p className="text-slate-500 text-center py-4">Nenhuma rota atribuída</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}