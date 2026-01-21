import React from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Award
} from 'lucide-react';
import HoneyStatsCard from '@/components/ui/HoneyStatsCard';
import { HoneyCard, HoneyCardHeader, HoneyCardTitle, HoneyCardContent } from '@/components/ui/HoneyCard';
import PageHeader from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';

const COLORS = ['#f59e0b', '#fbbf24', '#d97706', '#b45309', '#92400e'];

export default function Dashboard() {
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
            <Skeleton key={i} className="h-36 rounded-2xl bg-amber-100/50" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-2xl bg-amber-100/50" />
          <Skeleton className="h-80 rounded-2xl bg-amber-100/50" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header com tema Pão & Mel */}
      <PageHeader 
        title="Dashboard Principal"
        subtitle="Visão geral do desempenho comercial"
        icon={TrendingUp}
        showBee={true}
      />

      {/* KPIs com tema de mel */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <HoneyStatsCard
          title="Total Vendido"
          value={`R$ ${totalVendas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          subtitle={`${vendas.length} vendas realizadas`}
          icon={DollarSign}
          variant="honey"
        />
        <HoneyStatsCard
          title="Clientes Ativos"
          value={clientesAtivos}
          subtitle={`de ${clientes.length} cadastrados`}
          icon={Users}
          variant="dark"
        />
        <HoneyStatsCard
          title="Vendedores"
          value={vendedoresAtivos}
          subtitle="ativos na equipe"
          icon={Award}
          variant="golden"
        />
        <HoneyStatsCard
          title="Trocas"
          value={totalTrocas}
          subtitle="processadas"
          icon={ArrowLeftRight}
          variant="amber"
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HoneyCard variant="glass" glow>
          <HoneyCardHeader>
            <HoneyCardTitle icon={TrendingUp}>Vendas por Mês</HoneyCardTitle>
          </HoneyCardHeader>
          <HoneyCardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={vendasPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="#fcd34d40" />
                <XAxis dataKey="mes" tick={{ fill: '#92400e', fontSize: 12 }} />
                <YAxis tick={{ fill: '#92400e', fontSize: 12 }} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
                <Tooltip 
                  formatter={(value) => [`R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Valor']}
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: '1px solid #fbbf24', 
                    boxShadow: '0 10px 40px rgba(245,158,11,0.2)',
                    backgroundColor: '#fffbeb'
                  }}
                />
                <Bar dataKey="valor" fill="url(#honeyGradient)" radius={[8, 8, 0, 0]} />
                <defs>
                  <linearGradient id="honeyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbbf24" />
                    <stop offset="100%" stopColor="#d97706" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </HoneyCardContent>
        </HoneyCard>

        <HoneyCard variant="glass" glow>
          <HoneyCardHeader>
            <HoneyCardTitle icon={Package}>Top 5 Produtos</HoneyCardTitle>
          </HoneyCardHeader>
          <HoneyCardContent>
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
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: '1px solid #fbbf24', 
                    boxShadow: '0 10px 40px rgba(245,158,11,0.2)',
                    backgroundColor: '#fffbeb'
                  }}
                />
                <Legend 
                  verticalAlign="bottom" 
                  align="center"
                  wrapperStyle={{ paddingTop: '20px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </HoneyCardContent>
        </HoneyCard>
      </div>

      {/* Ranking Vendedores */}
      <HoneyCard variant="default" glow>
        <HoneyCardHeader>
          <HoneyCardTitle icon={Award}>Ranking de Vendedores</HoneyCardTitle>
        </HoneyCardHeader>
        <HoneyCardContent>
          <div className="space-y-4">
            {topVendedores.map((v, idx) => (
              <div key={v.nome} className="flex items-center gap-4 p-3 rounded-xl hover:bg-amber-50/50 transition-colors">
                {/* Posição com hexágono */}
                <div className="relative">
                  <svg viewBox="0 0 100 115.47" className={`w-12 h-14 ${idx < 3 ? 'drop-shadow-md' : ''}`}>
                    <defs>
                      <linearGradient id={`rankGrad${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        {idx === 0 ? (
                          <>
                            <stop offset="0%" stopColor="#fbbf24" />
                            <stop offset="100%" stopColor="#f59e0b" />
                          </>
                        ) : idx === 1 ? (
                          <>
                            <stop offset="0%" stopColor="#d1d5db" />
                            <stop offset="100%" stopColor="#9ca3af" />
                          </>
                        ) : idx === 2 ? (
                          <>
                            <stop offset="0%" stopColor="#d97706" />
                            <stop offset="100%" stopColor="#b45309" />
                          </>
                        ) : (
                          <>
                            <stop offset="0%" stopColor="#fef3c7" />
                            <stop offset="100%" stopColor="#fde68a" />
                          </>
                        )}
                      </linearGradient>
                    </defs>
                    <polygon 
                      points="50,0 100,28.87 100,86.60 50,115.47 0,86.60 0,28.87"
                      fill={`url(#rankGrad${idx})`}
                    />
                  </svg>
                  <span className={`absolute inset-0 flex items-center justify-center font-black text-lg ${idx < 3 ? 'text-amber-950' : 'text-amber-700'}`}>
                    {idx + 1}
                  </span>
                </div>
                
                <div className="flex-1">
                  <div className="flex justify-between mb-2">
                    <span className="font-semibold text-neutral-800">{v.nome}</span>
                    <span className="font-bold text-amber-700">
                      R$ {v.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="h-3 bg-amber-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 rounded-full transition-all duration-700 shadow-inner"
                      style={{ width: `${topVendedores[0]?.valor ? (v.valor / topVendedores[0].valor) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {topVendedores.length === 0 && (
              <div className="text-center py-12">
                <svg viewBox="0 0 100 115.47" className="w-16 h-18 mx-auto mb-4 opacity-30">
                  <polygon points="50,0 100,28.87 100,86.60 50,115.47 0,86.60 0,28.87" fill="#f59e0b"/>
                </svg>
                <p className="text-amber-700 font-medium">Nenhuma venda registrada ainda</p>
              </div>
            )}
          </div>
        </HoneyCardContent>
      </HoneyCard>
    </div>
  );
}