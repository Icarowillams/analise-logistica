import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { ArrowLeftRight, TrendingDown, Package, Users, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StatsCard from '@/components/ui/StatsCard';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#6366f1'];

export default function DashboardTrocas() {
  const [periodo, setPeriodo] = useState(new Date().toISOString().slice(0, 7));

  const { data: trocas = [], isLoading: lT } = useQuery({ queryKey: ['trocas'], queryFn: () => base44.entities.Troca.list('-data', 5000) });
  const { data: motivos = [] } = useQuery({ queryKey: ['motivosTroca'], queryFn: () => base44.entities.MotivoTroca.list() });
  const { data: vendas = [] } = useQuery({ queryKey: ['vendas'], queryFn: () => base44.entities.Venda.list('-data', 5000) });

  const isLoading = lT;

  const trocasPeriodo = trocas.filter(t => t.data?.startsWith(periodo));
  const vendasPeriodo = vendas.filter(v => v.data?.startsWith(periodo));

  // Métricas
  const totalTrocas = trocasPeriodo.length;
  const taxaTroca = vendasPeriodo.length > 0 ? ((totalTrocas / vendasPeriodo.length) * 100) : 0;

  // Trocas por motivo
  const trocasPorMotivo = React.useMemo(() => {
    const grouped = {};
    trocasPeriodo.forEach(t => {
      const motivo = t.motivo_descricao || 'Não informado';
      if (!grouped[motivo]) grouped[motivo] = 0;
      grouped[motivo] += 1;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));
  }, [trocasPeriodo]);

  // Trocas por cliente
  const trocasPorCliente = React.useMemo(() => {
    const grouped = {};
    trocasPeriodo.forEach(t => {
      const cliente = t.cliente_nome || 'Desconhecido';
      if (!grouped[cliente]) grouped[cliente] = 0;
      grouped[cliente] += 1;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([nome, qtd]) => ({ nome, qtd }));
  }, [trocasPeriodo]);

  // Trocas por produto
  const trocasPorProduto = React.useMemo(() => {
    const grouped = {};
    trocasPeriodo.forEach(t => {
      const produto = t.produto_original_nome || 'Desconhecido';
      if (!grouped[produto]) grouped[produto] = 0;
      grouped[produto] += 1;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([nome, qtd]) => ({ nome, qtd }));
  }, [trocasPeriodo]);

  // Histórico mensal
  const historicoMensal = React.useMemo(() => {
    const grouped = {};
    trocas.forEach(t => {
      if (!t.data) return;
      const month = t.data.substring(0, 7);
      if (!grouped[month]) grouped[month] = 0;
      grouped[month] += 1;
    });
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, qtd]) => ({
        mes: new Date(month + '-01').toLocaleDateString('pt-BR', { month: 'short' }),
        qtd
      }));
  }, [trocas]);

  const periodos = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    periodos.push(d.toISOString().slice(0, 7));
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
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
            <p className="text-slate-500">Análise de trocas de produtos</p>
          </div>
        </div>
        <Select value={periodo} onValueChange={setPeriodo}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodos.map(p => (
              <SelectItem key={p} value={p}>
                {new Date(p + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard
          title="Total de Trocas"
          value={totalTrocas}
          subtitle="no período selecionado"
          icon={ArrowLeftRight}
          gradient="from-orange-500 to-red-600"
        />
        <StatsCard
          title="Taxa de Troca"
          value={`${taxaTroca.toFixed(1)}%`}
          subtitle="em relação às vendas"
          icon={TrendingDown}
          gradient="from-amber-500 to-orange-500"
        />
        <StatsCard
          title="Motivos Diferentes"
          value={trocasPorMotivo.length}
          subtitle="identificados"
          icon={AlertTriangle}
          gradient="from-purple-500 to-pink-600"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Trocas por Motivo</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={trocasPorMotivo}
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {trocasPorMotivo.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Evolução Mensal</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={historicoMensal}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} />
                <Line type="monotone" dataKey="qtd" stroke="#ef4444" strokeWidth={3} dot={{ fill: '#ef4444', r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabelas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Clientes com Mais Trocas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {trocasPorCliente.map((c, idx) => (
                <div key={c.nome} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-red-600 font-semibold text-sm">
                      {idx + 1}
                    </div>
                    <span className="font-medium text-slate-700">{c.nome}</span>
                  </div>
                  <Badge className="bg-red-100 text-red-700">{c.qtd} trocas</Badge>
                </div>
              ))}
              {trocasPorCliente.length === 0 && (
                <p className="text-slate-500 text-center py-4">Nenhuma troca encontrada</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Produtos com Mais Trocas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {trocasPorProduto.map((p, idx) => (
                <div key={p.nome} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600 font-semibold text-sm">
                      {idx + 1}
                    </div>
                    <span className="font-medium text-slate-700">{p.nome}</span>
                  </div>
                  <Badge className="bg-orange-100 text-orange-700">{p.qtd} trocas</Badge>
                </div>
              ))}
              {trocasPorProduto.length === 0 && (
                <p className="text-slate-500 text-center py-4">Nenhuma troca encontrada</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}