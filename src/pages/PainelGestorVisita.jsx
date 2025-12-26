import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { Route, Users, Download, Filter, Search, MapPin } from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'];

export default function PainelGestorVisita() {
  const [filtroDia, setFiltroDia] = useState('todos');
  const [filtroPromotor, setFiltroPromotor] = useState('todos');
  const [busca, setBusca] = useState('');

  const { data: resultado, isLoading } = useQuery({
    queryKey: ['roteirosGestorVisita'],
    queryFn: async () => {
      const response = await base44.functions.invoke('buscarRoteirosGestorVisita', {});
      return response.data;
    },
    refetchInterval: 30000
  });

  const roteiros = resultado?.roteiros || [];

  // Promotores únicos para filtro
  const promotoresUnicos = useMemo(() => {
    const promotores = new Set();
    roteiros.forEach(r => {
      if (r.promotor_nome) promotores.add(r.promotor_nome);
    });
    return Array.from(promotores).sort();
  }, [roteiros]);

  // Dias únicos para filtro
  const diasUnicos = useMemo(() => {
    const dias = new Set();
    roteiros.forEach(r => {
      if (r.dia_semana) dias.add(r.dia_semana);
    });
    return Array.from(dias).sort();
  }, [roteiros]);

  // Roteiros filtrados
  const roteirosFiltrados = useMemo(() => {
    return roteiros.filter(r => {
      if (filtroDia !== 'todos' && r.dia_semana !== filtroDia) return false;
      if (filtroPromotor !== 'todos' && r.promotor_nome !== filtroPromotor) return false;
      if (busca) {
        const termo = busca.toLowerCase();
        return (
          r.promotor_nome?.toLowerCase().includes(termo) ||
          r.dia_semana?.toLowerCase().includes(termo) ||
          r.status?.toLowerCase().includes(termo) ||
          r.promotor_id?.toLowerCase().includes(termo)
        );
      }
      return true;
    });
  }, [roteiros, filtroDia, filtroPromotor, busca]);

  // Estatísticas
  const stats = useMemo(() => {
    const total = roteirosFiltrados.length;
    const promotores = new Set(roteirosFiltrados.map(r => r.promotor_id).filter(Boolean)).size;
    const clientesTotais = roteirosFiltrados.reduce((sum, r) => sum + (r.clientes_ids?.length || 0), 0);

    return {
      total,
      promotores,
      clientesTotais
    };
  }, [roteirosFiltrados]);

  // Roteiros por dia da semana
  const roteirosPorDia = useMemo(() => {
    const diasOrdem = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const grouped = {};
    diasOrdem.forEach(d => grouped[d] = 0);
    
    roteirosFiltrados.forEach(r => {
      if (r.dia_semana && grouped[r.dia_semana] !== undefined) {
        grouped[r.dia_semana]++;
      }
    });
    
    return diasOrdem.map(dia => ({ dia, qtd: grouped[dia] }));
  }, [roteirosFiltrados]);

  // Roteiros por promotor
  const roteirosPorPromotor = useMemo(() => {
    const grouped = {};
    roteirosFiltrados.forEach(r => {
      const promotor = r.promotor_nome || 'Sem promotor';
      grouped[promotor] = (grouped[promotor] || 0) + 1;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([nome, qtd]) => ({ nome, qtd }));
  }, [roteirosFiltrados]);

  // Clientes por roteiro (média)
  const clientesPorRoteiro = useMemo(() => {
    const dados = roteirosFiltrados.map(r => ({
      promotor: r.promotor_nome?.split(' ')[0] || 'N/A',
      clientes: r.clientes_ids?.length || 0
    })).slice(0, 10);
    return dados;
  }, [roteirosFiltrados]);

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
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
            <Route className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Gestão de Roteiros</h1>
            <p className="text-slate-500">Visualização dos roteiros do Gestor Visita</p>
          </div>
        </div>
        <Button className="bg-gradient-to-r from-yellow-400 to-amber-500 text-neutral-900 hover:from-yellow-500 hover:to-amber-600">
          <Download className="w-4 h-4 mr-2" />
          Exportar Roteiros ({stats.total})
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard
          title="Total de Roteiros"
          value={stats.total}
          subtitle="encontrados"
          icon={Route}
          gradient="from-yellow-400 to-amber-500"
        />
        <StatsCard
          title="Promotores"
          value={stats.promotores}
          subtitle="ativos"
          icon={Users}
          gradient="from-yellow-400 to-amber-500"
        />
        <StatsCard
          title="Total de Clientes"
          value={stats.clientesTotais}
          subtitle="nos roteiros"
          icon={MapPin}
          gradient="from-yellow-400 to-amber-500"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="busca" className="w-full">
        <TabsList>
          <TabsTrigger value="busca">Busca de Roteiros</TabsTrigger>
          <TabsTrigger value="graficos">Análises</TabsTrigger>
        </TabsList>

        <TabsContent value="busca" className="space-y-4">
          {/* Filtros */}
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-slate-600" />
                <CardTitle className="text-base">Filtros</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Filtrar por dia</label>
                  <Select value={filtroDia} onValueChange={setFiltroDia}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos os dias" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os dias</SelectItem>
                      {diasUnicos.map(dia => (
                        <SelectItem key={dia} value={dia}>{dia}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Filtrar por funcionário</label>
                  <Select value={filtroPromotor} onValueChange={setFiltroPromotor}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos os promotores" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os promotores</SelectItem>
                      {promotoresUnicos.map(promotor => (
                        <SelectItem key={promotor} value={promotor}>{promotor}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Buscar</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      placeholder="Buscar roteiros..."
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabela de Roteiros */}
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Roteiros Encontrados ({roteirosFiltrados.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-slate-200">
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Dia da Semana</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Funcionário</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">ID do Roteiro</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Clientes</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roteirosFiltrados.map((roteiro, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-3 text-sm text-slate-700 font-medium">
                          {roteiro.dia_semana || 'N/A'}
                        </td>
                        <td className="p-3 text-sm text-slate-700">
                          {roteiro.promotor_nome || 'N/A'}
                        </td>
                        <td className="p-3 text-xs font-mono text-slate-600">
                          <div className="space-y-0.5">
                            <div>Func ID: {roteiro.promotor_id?.substring(0, 20) || 'N/A'}</div>
                            <div>Roteiro ID: {roteiro.id?.substring(0, 20) || 'N/A'}</div>
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <Badge className="bg-slate-100 text-slate-700">
                            {roteiro.clientes_ids?.length || 0} clientes
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          <Badge className="bg-blue-100 text-blue-700">
                            {roteiro.status || 'planejado'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="graficos" className="space-y-6">
          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Dia da Semana */}
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="text-base">Roteiros por Dia da Semana</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={roteirosPorDia}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="dia" tick={{ fill: '#64748b', fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="qtd" fill="#fbbf24" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top Promotores */}
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="text-base">Roteiros por Promotor</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={roteirosPorPromotor} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} />
                    <YAxis dataKey="nome" type="category" tick={{ fill: '#64748b', fontSize: 10 }} width={100} />
                    <Tooltip />
                    <Bar dataKey="qtd" fill="#f59e0b" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Clientes por Roteiro */}
            <Card className="border-0 shadow-lg lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Clientes por Roteiro (Top 10)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={clientesPorRoteiro}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="promotor" tick={{ fill: '#64748b', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="clientes" fill="#6366f1" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}