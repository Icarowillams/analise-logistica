import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Eye, Package, ArrowLeftRight, Search, Filter, 
  MapPin, Calendar, User, CheckCircle, XCircle, Clock,
  TrendingUp, AlertTriangle, FileText, Download, RefreshCw
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function RelatoriosGestorVisita() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroPromotor, setFiltroPromotor] = useState('todos');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  const { data: visitas = [], isLoading: loadingVisitas, refetch: refetchVisitas } = useQuery({
    queryKey: ['relatorioVisitas'],
    queryFn: () => base44.entities.RelatorioVisita.list('-data_visita', 1000),
    refetchInterval: 2 * 60 * 60 * 1000
  });

  const { data: estoques = [], isLoading: loadingEstoques } = useQuery({
    queryKey: ['relatorioEstoques'],
    queryFn: () => base44.entities.RelatorioEstoque.list('-data_registro', 1000),
    refetchInterval: 2 * 60 * 60 * 1000
  });

  const { data: trocas = [], isLoading: loadingTrocas } = useQuery({
    queryKey: ['relatorioTrocas'],
    queryFn: () => base44.entities.RelatorioTroca.list('-data_registro', 1000),
    refetchInterval: 2 * 60 * 60 * 1000
  });

  // Promotores únicos
  const promotoresUnicos = useMemo(() => {
    const proms = new Set();
    visitas.forEach(v => v.promotor_nome && proms.add(v.promotor_nome));
    return Array.from(proms).sort();
  }, [visitas]);

  // Visitas filtradas
  const visitasFiltradas = useMemo(() => {
    return visitas.filter(v => {
      if (filtroStatus !== 'todos' && v.status !== filtroStatus) return false;
      if (filtroPromotor !== 'todos' && v.promotor_nome !== filtroPromotor) return false;
      if (dataInicio && v.data_visita < dataInicio) return false;
      if (dataFim && v.data_visita > dataFim) return false;
      if (busca) {
        const termo = busca.toLowerCase();
        return (
          v.cliente_nome?.toLowerCase().includes(termo) ||
          v.cliente_codigo?.toLowerCase().includes(termo) ||
          v.promotor_nome?.toLowerCase().includes(termo) ||
          v.cliente_cidade?.toLowerCase().includes(termo)
        );
      }
      return true;
    });
  }, [visitas, filtroStatus, filtroPromotor, busca, dataInicio, dataFim]);

  // Estoques filtrados
  const estoquesFiltrados = useMemo(() => {
    return estoques.filter(e => {
      if (filtroPromotor !== 'todos' && e.promotor_nome !== filtroPromotor) return false;
      if (dataInicio && e.data_registro < dataInicio) return false;
      if (dataFim && e.data_registro > dataFim) return false;
      if (busca) {
        const termo = busca.toLowerCase();
        return (
          e.cliente_nome?.toLowerCase().includes(termo) ||
          e.produto_descricao?.toLowerCase().includes(termo) ||
          e.produto_codigo?.toLowerCase().includes(termo)
        );
      }
      return true;
    });
  }, [estoques, filtroPromotor, busca, dataInicio, dataFim]);

  // Trocas filtradas
  const trocasFiltradas = useMemo(() => {
    return trocas.filter(t => {
      if (filtroPromotor !== 'todos' && t.promotor_nome !== filtroPromotor) return false;
      if (dataInicio && t.data_registro < dataInicio) return false;
      if (dataFim && t.data_registro > dataFim) return false;
      if (busca) {
        const termo = busca.toLowerCase();
        return (
          t.cliente_nome?.toLowerCase().includes(termo) ||
          t.produto_descricao?.toLowerCase().includes(termo) ||
          t.motivo_troca?.toLowerCase().includes(termo)
        );
      }
      return true;
    });
  }, [trocas, filtroPromotor, busca, dataInicio, dataFim]);

  // Stats
  const stats = useMemo(() => ({
    totalVisitas: visitasFiltradas.length,
    visitasRealizadas: visitasFiltradas.filter(v => v.status === 'realizada').length,
    visitasPendentes: visitasFiltradas.filter(v => v.status === 'pendente').length,
    visitasNaoRealizadas: visitasFiltradas.filter(v => v.status === 'nao_realizada').length,
    totalEstoques: estoquesFiltrados.reduce((sum, e) => sum + (e.quantidade || 0), 0),
    totalTrocas: trocasFiltradas.reduce((sum, t) => sum + (t.quantidade || 0), 0),
    taxaSucesso: visitasFiltradas.length > 0 
      ? ((visitasFiltradas.filter(v => v.status === 'realizada').length / visitasFiltradas.length) * 100).toFixed(1)
      : 0,
    comPedido: visitasFiltradas.filter(v => v.pedido_solicitado).length
  }), [visitasFiltradas, estoquesFiltrados, trocasFiltradas]);

  // Gráfico: Visitas por Promotor
  const visitasPorPromotor = useMemo(() => {
    const map = {};
    visitasFiltradas.forEach(v => {
      const nome = v.promotor_nome || 'Sem Promotor';
      map[nome] = (map[nome] || 0) + 1;
    });
    return Object.entries(map)
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [visitasFiltradas]);

  // Gráfico: Status das Visitas
  const statusData = useMemo(() => [
    { name: 'Realizadas', value: stats.visitasRealizadas, color: '#10b981' },
    { name: 'Não Realizadas', value: stats.visitasNaoRealizadas, color: '#ef4444' },
    { name: 'Pendentes', value: stats.visitasPendentes, color: '#f59e0b' }
  ], [stats]);

  // Gráfico: Trocas por Motivo
  const trocasPorMotivo = useMemo(() => {
    const map = {};
    trocasFiltradas.forEach(t => {
      const motivo = t.motivo_troca || 'Sem Motivo';
      map[motivo] = (map[motivo] || 0) + (t.quantidade || 0);
    });
    return Object.entries(map)
      .map(([motivo, quantidade]) => ({ motivo, quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 8);
  }, [trocasFiltradas]);

  const limparFiltros = () => {
    setBusca('');
    setFiltroStatus('todos');
    setFiltroPromotor('todos');
    setDataInicio('');
    setDataFim('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-xl">
            <Eye className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Relatórios de Visitas</h1>
            <p className="text-slate-500 mt-1">Análise completa das visitas do Gestor Visita</p>
          </div>
        </div>
        <Button onClick={() => refetchVisitas()} variant="outline" className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total de Visitas"
          value={stats.totalVisitas}
          subtitle={`${stats.taxaSucesso}% realizadas`}
          icon={Eye}
          gradient="from-purple-500 to-indigo-600"
        />
        <StatsCard
          title="Visitas Realizadas"
          value={stats.visitasRealizadas}
          subtitle={`${stats.comPedido} com pedido`}
          icon={CheckCircle}
          gradient="from-green-500 to-emerald-600"
        />
        <StatsCard
          title="Estoque Total"
          value={stats.totalEstoques}
          subtitle={`${estoquesFiltrados.length} registros`}
          icon={Package}
          gradient="from-blue-500 to-cyan-600"
        />
        <StatsCard
          title="Trocas Realizadas"
          value={stats.totalTrocas}
          subtitle={`${trocasFiltradas.length} ocorrências`}
          icon={ArrowLeftRight}
          gradient="from-orange-500 to-red-600"
        />
      </div>

      {/* Filtros Avançados */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-slate-600" />
              <CardTitle>Filtros Avançados</CardTitle>
            </div>
            <Button variant="ghost" size="sm" onClick={limparFiltros}>
              Limpar Filtros
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Status</label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="realizada">✅ Realizada</SelectItem>
                  <SelectItem value="nao_realizada">❌ Não Realizada</SelectItem>
                  <SelectItem value="pendente">⏳ Pendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Promotor</label>
              <Select value={filtroPromotor} onValueChange={setFiltroPromotor}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {promotoresUnicos.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Início</label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Fim</label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Buscar</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Cliente, produto..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Gráficos de Análise */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg">Visitas por Promotor</CardTitle>
            <CardDescription>Top 10 promotores mais ativos</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={visitasPorPromotor}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="nome" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg">Status das Visitas</CardTitle>
            <CardDescription>Distribuição por status</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Motivos de Troca</CardTitle>
            <CardDescription>Quantidade trocada por motivo</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trocasPorMotivo} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="motivo" type="category" width={150} />
                <Tooltip />
                <Bar dataKey="quantidade" fill="#f97316" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabs com Dados Detalhados */}
      <Tabs defaultValue="visitas" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="visitas" className="gap-2">
            <Eye className="w-4 h-4" />
            Visitas ({visitasFiltradas.length})
          </TabsTrigger>
          <TabsTrigger value="estoques" className="gap-2">
            <Package className="w-4 h-4" />
            Estoques ({estoquesFiltrados.length})
          </TabsTrigger>
          <TabsTrigger value="trocas" className="gap-2">
            <ArrowLeftRight className="w-4 h-4" />
            Trocas ({trocasFiltradas.length})
          </TabsTrigger>
        </TabsList>

        {/* Visitas Tab */}
        <TabsContent value="visitas" className="mt-6">
          <Card className="border-0 shadow-lg">
            <CardContent className="pt-6">
              {loadingVisitas ? (
                <div className="text-center py-8 text-slate-500">Carregando...</div>
              ) : visitasFiltradas.length === 0 ? (
                <div className="text-center py-12">
                  <Eye className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">Nenhuma visita encontrada</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Data/Hora</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Cliente</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Localização</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Promotor</th>
                        <th className="text-center p-4 text-sm font-semibold text-slate-700">Status</th>
                        <th className="text-center p-4 text-sm font-semibold text-slate-700">Pedido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visitasFiltradas.map((visita, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-slate-400" />
                              <div>
                                <div className="font-medium text-slate-900">
                                  {new Date(visita.data_visita).toLocaleDateString('pt-BR')}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {visita.checkin_time && new Date(visita.checkin_time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="font-semibold text-slate-900">{visita.cliente_nome}</div>
                            <div className="text-xs text-slate-500">Cód: {visita.cliente_codigo}</div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-slate-400" />
                              <div>
                                <div className="text-sm text-slate-700">{visita.cliente_cidade} - {visita.cliente_uf}</div>
                                {visita.cliente_segmento && (
                                  <div className="text-xs text-slate-500">{visita.cliente_segmento}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4 text-slate-400" />
                              <span className="text-sm text-slate-700">{visita.promotor_nome}</span>
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            <Badge className={
                              visita.status === 'realizada' ? 'bg-green-100 text-green-700 border-green-200' :
                              visita.status === 'nao_realizada' ? 'bg-red-100 text-red-700 border-red-200' :
                              'bg-yellow-100 text-yellow-700 border-yellow-200'
                            }>
                              {visita.status === 'realizada' ? '✓ Realizada' :
                               visita.status === 'nao_realizada' ? '✗ Não Realizada' : '⏳ Pendente'}
                            </Badge>
                          </td>
                          <td className="p-4 text-center">
                            {visita.pedido_solicitado ? (
                              <CheckCircle className="w-5 h-5 text-green-600 mx-auto" />
                            ) : (
                              <XCircle className="w-5 h-5 text-slate-300 mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Estoques Tab */}
        <TabsContent value="estoques" className="mt-6">
          <Card className="border-0 shadow-lg">
            <CardContent className="pt-6">
              {loadingEstoques ? (
                <div className="text-center py-8 text-slate-500">Carregando...</div>
              ) : estoquesFiltrados.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">Nenhum estoque encontrado</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Data</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Cliente</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Produto</th>
                        <th className="text-center p-4 text-sm font-semibold text-slate-700">Quantidade</th>
                        <th className="text-center p-4 text-sm font-semibold text-slate-700">Validade</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Promotor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {estoquesFiltrados.map((estoque, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-slate-400" />
                              <span className="text-sm text-slate-700">
                                {new Date(estoque.data_registro).toLocaleDateString('pt-BR')}
                              </span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="font-semibold text-slate-900">{estoque.cliente_nome}</div>
                            <div className="text-xs text-slate-500">Cód: {estoque.cliente_codigo}</div>
                          </td>
                          <td className="p-4">
                            <div className="font-medium text-slate-900">{estoque.produto_descricao}</div>
                            <div className="text-xs text-slate-500">
                              {estoque.produto_codigo} {estoque.produto_gramatura && `• ${estoque.produto_gramatura}`}
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            <Badge className="bg-blue-100 text-blue-700 text-base px-3 py-1">
                              {estoque.quantidade}
                            </Badge>
                          </td>
                          <td className="p-4 text-center text-sm text-slate-700">
                            {estoque.data_validade ? (
                              <div className="flex items-center justify-center gap-1">
                                <Clock className="w-4 h-4 text-slate-400" />
                                {new Date(estoque.data_validade).toLocaleDateString('pt-BR')}
                              </div>
                            ) : '-'}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4 text-slate-400" />
                              <span className="text-sm text-slate-700">{estoque.promotor_nome}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trocas Tab */}
        <TabsContent value="trocas" className="mt-6">
          <Card className="border-0 shadow-lg">
            <CardContent className="pt-6">
              {loadingTrocas ? (
                <div className="text-center py-8 text-slate-500">Carregando...</div>
              ) : trocasFiltradas.length === 0 ? (
                <div className="text-center py-12">
                  <ArrowLeftRight className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">Nenhuma troca encontrada</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Data</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Cliente</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Produto</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Motivo</th>
                        <th className="text-center p-4 text-sm font-semibold text-slate-700">Qtd</th>
                        <th className="text-center p-4 text-sm font-semibold text-slate-700">Vida Útil</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Promotor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {trocasFiltradas.map((troca, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-slate-400" />
                              <span className="text-sm text-slate-700">
                                {new Date(troca.data_registro).toLocaleDateString('pt-BR')}
                              </span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="font-semibold text-slate-900">{troca.cliente_nome}</div>
                            <div className="text-xs text-slate-500">Cód: {troca.cliente_codigo}</div>
                          </td>
                          <td className="p-4">
                            <div className="font-medium text-slate-900">{troca.produto_descricao}</div>
                            <div className="text-xs text-slate-500">{troca.produto_codigo}</div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-orange-500" />
                              <span className="text-sm text-slate-700">{troca.motivo_troca || '-'}</span>
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            <Badge className="bg-orange-100 text-orange-700 text-base px-3 py-1">
                              {troca.quantidade}
                            </Badge>
                          </td>
                          <td className="p-4 text-center">
                            {troca.dias_vida_util !== null && troca.dias_vida_util !== undefined ? (
                              <Badge className={
                                troca.dias_vida_util < 0 ? 'bg-red-100 text-red-700 border-red-200' :
                                troca.dias_vida_util < 10 ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                'bg-green-100 text-green-700 border-green-200'
                              }>
                                {troca.dias_vida_util} dias
                              </Badge>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4 text-slate-400" />
                              <span className="text-sm text-slate-700">{troca.promotor_nome}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}