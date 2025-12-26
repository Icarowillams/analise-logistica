import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { Route, Users, Calendar, CheckCircle, XCircle, Clock } from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'];

export default function PainelGestorVisita() {
  const { data: resultado, isLoading } = useQuery({
    queryKey: ['roteirosGestorVisita'],
    queryFn: async () => {
      const response = await base44.functions.invoke('buscarRoteirosGestorVisita', {});
      return response.data;
    },
    refetchInterval: 30000 // Atualiza a cada 30 segundos
  });

  const roteiros = resultado?.roteiros || [];

  // Estatísticas
  const stats = useMemo(() => {
    const total = roteiros.length;
    const ativos = roteiros.filter(r => r.status === 'ativo').length;
    const concluidos = roteiros.filter(r => r.status === 'concluído' || r.status === 'concluido').length;
    const inativos = roteiros.filter(r => r.status === 'inativo').length;
    const promotoresUnicos = new Set(roteiros.map(r => r.promotor_id).filter(Boolean)).size;
    const clientesTotais = roteiros.reduce((sum, r) => sum + (r.clientes_ids?.length || 0), 0);

    return {
      total,
      ativos,
      concluidos,
      inativos,
      promotoresUnicos,
      clientesTotais
    };
  }, [roteiros]);

  // Roteiros por status
  const roteirosPorStatus = useMemo(() => {
    const grouped = {};
    roteiros.forEach(r => {
      const status = r.status || 'Não definido';
      grouped[status] = (grouped[status] || 0) + 1;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [roteiros]);

  // Roteiros por dia da semana
  const roteirosPorDia = useMemo(() => {
    const dias = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
    const grouped = {};
    dias.forEach(d => grouped[d] = 0);
    
    roteiros.forEach(r => {
      if (r.dia_semana && grouped[r.dia_semana] !== undefined) {
        grouped[r.dia_semana]++;
      }
    });
    
    return Object.entries(grouped).map(([dia, qtd]) => ({ dia, qtd }));
  }, [roteiros]);

  // Roteiros por promotor
  const roteirosPorPromotor = useMemo(() => {
    const grouped = {};
    roteiros.forEach(r => {
      const promotor = r.promotor_nome || r.promotor_id || 'Sem promotor';
      grouped[promotor] = (grouped[promotor] || 0) + 1;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([nome, qtd]) => ({ nome, qtd }));
  }, [roteiros]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
          <Route className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Painel Gestor Visita</h1>
          <p className="text-slate-500">Visualização dos roteiros em tempo real</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard
          title="Total de Roteiros"
          value={stats.total}
          subtitle="cadastrados no sistema"
          icon={Route}
          gradient="from-blue-500 to-cyan-600"
        />
        <StatsCard
          title="Roteiros Ativos"
          value={stats.ativos}
          subtitle="em andamento"
          icon={CheckCircle}
          gradient="from-emerald-500 to-teal-600"
        />
        <StatsCard
          title="Roteiros Concluídos"
          value={stats.concluidos}
          subtitle="finalizados"
          icon={Clock}
          gradient="from-purple-500 to-indigo-600"
        />
        <StatsCard
          title="Roteiros Inativos"
          value={stats.inativos}
          subtitle="desativados"
          icon={XCircle}
          gradient="from-slate-500 to-slate-600"
        />
        <StatsCard
          title="Promotores"
          value={stats.promotoresUnicos}
          subtitle="atuando"
          icon={Users}
          gradient="from-orange-500 to-amber-500"
        />
        <StatsCard
          title="Total de Clientes"
          value={stats.clientesTotais}
          subtitle="nos roteiros"
          icon={Users}
          gradient="from-pink-500 to-rose-600"
        />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg">Roteiros por Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={roteirosPorStatus}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {roteirosPorStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Dia da Semana */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg">Roteiros por Dia da Semana</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={roteirosPorDia}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="dia" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="qtd" fill="#3b82f6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Promotores */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">Top 10 Promotores</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {roteirosPorPromotor.map((p, idx) => (
              <div key={p.nome} className="flex items-center gap-4">
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
                    <span className="font-medium text-slate-700">{p.nome}</span>
                    <span className="font-semibold text-slate-900">{p.qtd} roteiros</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full"
                      style={{ width: `${(p.qtd / roteirosPorPromotor[0]?.qtd) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lista de Roteiros */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">Últimos Roteiros ({roteiros.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left p-3 text-sm font-semibold text-slate-700">Promotor</th>
                  <th className="text-left p-3 text-sm font-semibold text-slate-700">Dia da Semana</th>
                  <th className="text-center p-3 text-sm font-semibold text-slate-700">Clientes</th>
                  <th className="text-center p-3 text-sm font-semibold text-slate-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {roteiros.slice(0, 50).map((roteiro, idx) => (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-3 text-sm text-slate-700">
                      {roteiro.promotor_nome || roteiro.promotor_id || 'N/A'}
                    </td>
                    <td className="p-3 text-sm text-slate-700">
                      {roteiro.dia_semana || 'N/A'}
                    </td>
                    <td className="p-3 text-center">
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        {roteiro.clientes_ids?.length || 0}
                      </Badge>
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={
                        roteiro.status === 'ativo' ? 'bg-green-100 text-green-700' :
                        roteiro.status === 'concluído' || roteiro.status === 'concluido' ? 'bg-purple-100 text-purple-700' :
                        'bg-slate-100 text-slate-700'
                      }>
                        {roteiro.status || 'N/A'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}