import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  DollarSign,
  Users,
  Package,
  ArrowLeftRight,
  TrendingUp,
  Award,
  Truck,
  RefreshCw,
  Loader2
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'];

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [logisticoLoading, setLogisticoLoading] = useState(false);
  const [omieLoading, setOmieLoading] = useState(false);

  const handleSincronizarLogistico = async () => {
    setLogisticoLoading(true);
    try {
      const res = await base44.functions.invoke('sincronizarStatusTrocaLogistico', {});
      const data = res.data;
      if (data.success) {
        toast.success(`${data.total_atualizados} troca(s) atualizada(s)`);
      } else {
        toast.error(data.error || 'Erro ao sincronizar');
      }
    } catch (e) {
      toast.error('Erro ao sincronizar com logístico');
    } finally {
      setLogisticoLoading(false);
    }
  };

  const handleSincronizarOmie = async () => {
    setOmieLoading(true);
    try {
      const res = await base44.functions.invoke('sincronizarStatusPedidosOmie', {});
      const data = res.data;
      if (data.success || data.sucesso) {
        toast.success(data.mensagem || `Pedidos Omie sincronizados!`);
      } else {
        toast.error(data.error || data.erro || 'Erro ao sincronizar com Omie');
      }
    } catch (e) {
      toast.error('Erro ao sincronizar com Omie');
    } finally {
      setOmieLoading(false);
    }
  };

  const { data: vendas = [], isLoading: loadingVendas } = useQuery({
    queryKey: ['vendas'],
    queryFn: () => base44.entities.Venda.list('-data', 1000)
  });

  const { data: clientes = [], isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: vendedores = [], isLoading: loadingVendedores } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: trocas = [], isLoading: loadingTrocas } = useQuery({
    queryKey: ['trocas'],
    queryFn: () => base44.entities.Troca.list('-data', 1000)
  });

  const isLoading = loadingVendas || loadingClientes || loadingVendedores || loadingTrocas;

  // Cálculos
  const totalVendas = vendas.reduce((sum, v) => sum + (v.valor_total || 0), 0);
  const clientesAtivos = clientes.filter(c => c.status === 'ativo').length;
  const vendedoresAtivos = vendedores.filter(v => v.status === 'ativo').length;
  const totalTrocas = trocas.length;

  // Vendas por mês
  const vendasPorMes = React.useMemo(() => {
    const grouped = {};
    vendas.forEach(v => {
      if (!v.data) return;
      const month = v.data.substring(0, 7);
      if (!grouped[month]) grouped[month] = 0;
      grouped[month] += v.valor_total || 0;
    });
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, total]) => ({
        mes: new Date(month + '-01').toLocaleDateString('pt-BR', { month: 'short' }),
        valor: total
      }));
  }, [vendas]);

  // Top vendedores
  const topVendedores = React.useMemo(() => {
    const grouped = {};
    vendas.forEach(v => {
      const nome = v.vendedor_nome || 'Desconhecido';
      if (!grouped[nome]) grouped[nome] = 0;
      grouped[nome] += v.valor_total || 0;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([nome, valor]) => ({ nome, valor }));
  }, [vendas]);

  // Vendas por produto
  const vendasPorProduto = React.useMemo(() => {
    const grouped = {};
    vendas.forEach(v => {
      const nome = v.produto_nome || 'Desconhecido';
      if (!grouped[nome]) grouped[nome] = 0;
      grouped[nome] += v.quantidade || 0;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));
  }, [vendas]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 shrink-0">
          <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Dashboard Principal</h1>
          <p className="text-xs sm:text-sm text-slate-500">Visão geral do desempenho comercial</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleSincronizarLogistico}
            disabled={logisticoLoading}
          >
            {logisticoLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Truck className="w-3 h-3 mr-1" />}
            Sinc. Logístico
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleSincronizarOmie}
            disabled={omieLoading}
          >
            {omieLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            Sinc. Omie
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <StatsCard
          title="Total Vendido"
          value={`R$ ${totalVendas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          subtitle={`${vendas.length} vendas realizadas`}
          icon={DollarSign}
          gradient="from-emerald-500 to-teal-600"
        />
        <StatsCard
          title="Clientes Ativos"
          value={clientesAtivos}
          subtitle={`de ${clientes.length} cadastrados`}
          icon={Users}
          gradient="from-blue-500 to-cyan-600"
        />
        <StatsCard
          title="Vendedores"
          value={vendedoresAtivos}
          subtitle="ativos na equipe"
          icon={Award}
          gradient="from-indigo-500 to-purple-600"
        />
        <StatsCard
          title="Trocas"
          value={totalTrocas}
          subtitle="processadas"
          icon={ArrowLeftRight}
          gradient="from-orange-500 to-amber-500"
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-slate-800">Vendas por Mês</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={vendasPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
                <Tooltip 
                  formatter={(value) => [`R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Valor']}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="valor" fill="url(#colorGradient)" radius={[8, 8, 0, 0]} />
                <defs>
                  <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-slate-800">Top 5 Produtos</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={vendasPorProduto}
                  cx="50%"
                  cy="40%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {vendasPorProduto.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value) => [value, 'Quantidade']}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}
                />
                <Legend 
                  verticalAlign="bottom" 
                  align="center"
                  wrapperStyle={{ paddingTop: '20px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Ranking Vendedores */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-slate-800">Ranking de Vendedores</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {topVendedores.map((v, idx) => (
              <div key={v.nome} className="flex items-center gap-4">
                <div className={`
                  w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white
                  ${idx === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 
                    idx === 1 ? 'bg-gradient-to-br from-slate-400 to-slate-500' :
                    idx === 2 ? 'bg-gradient-to-br from-amber-600 to-amber-700' :
                    'bg-gradient-to-br from-slate-300 to-slate-400'}
                `}>
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-medium text-slate-700">{v.nome}</span>
                    <span className="font-semibold text-slate-900">
                      R$ {v.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                      style={{ width: `${topVendedores[0]?.valor ? (v.valor / topVendedores[0].valor) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {topVendedores.length === 0 && (
              <p className="text-center text-slate-500 py-8">Nenhuma venda registrada ainda</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}