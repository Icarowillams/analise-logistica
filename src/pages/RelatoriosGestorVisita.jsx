import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Eye, Package, ArrowLeftRight, Search, Filter, 
  MapPin, Calendar, User
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';

export default function RelatoriosGestorVisita() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroPromotor, setFiltroPromotor] = useState('todos');

  const { data: visitas = [], isLoading: loadingVisitas } = useQuery({
    queryKey: ['relatorioVisitas'],
    queryFn: () => base44.entities.RelatorioVisita.list('-data_visita', 500)
  });

  const { data: estoques = [], isLoading: loadingEstoques } = useQuery({
    queryKey: ['relatorioEstoques'],
    queryFn: () => base44.entities.RelatorioEstoque.list('-data_registro', 500)
  });

  const { data: trocas = [], isLoading: loadingTrocas } = useQuery({
    queryKey: ['relatorioTrocas'],
    queryFn: () => base44.entities.RelatorioTroca.list('-data_registro', 500)
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
  }, [visitas, filtroStatus, filtroPromotor, busca]);

  // Estoques filtrados
  const estoquesFiltrados = useMemo(() => {
    return estoques.filter(e => {
      if (filtroPromotor !== 'todos' && e.promotor_nome !== filtroPromotor) return false;
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
  }, [estoques, filtroPromotor, busca]);

  // Trocas filtradas
  const trocasFiltradas = useMemo(() => {
    return trocas.filter(t => {
      if (filtroPromotor !== 'todos' && t.promotor_nome !== filtroPromotor) return false;
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
  }, [trocas, filtroPromotor, busca]);

  // Stats
  const stats = useMemo(() => ({
    totalVisitas: visitasFiltradas.length,
    visitasRealizadas: visitasFiltradas.filter(v => v.status === 'realizada').length,
    totalEstoques: estoquesFiltrados.reduce((sum, e) => sum + (e.quantidade || 0), 0),
    totalTrocas: trocasFiltradas.reduce((sum, t) => sum + (t.quantidade || 0), 0)
  }), [visitasFiltradas, estoquesFiltrados, trocasFiltradas]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
          <Eye className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Relatórios Gestor Visita</h1>
          <p className="text-slate-500">Dados importados das visitas comerciais</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatsCard
          title="Visitas"
          value={stats.totalVisitas}
          subtitle={`${stats.visitasRealizadas} realizadas`}
          icon={Eye}
          gradient="from-purple-500 to-indigo-600"
        />
        <StatsCard
          title="Visitas Realizadas"
          value={stats.visitasRealizadas}
          subtitle="concluídas com sucesso"
          icon={MapPin}
          gradient="from-blue-500 to-cyan-600"
        />
        <StatsCard
          title="Estoques Registrados"
          value={stats.totalEstoques}
          subtitle="unidades totais"
          icon={Package}
          gradient="from-emerald-500 to-teal-600"
        />
        <StatsCard
          title="Trocas"
          value={stats.totalTrocas}
          subtitle="unidades trocadas"
          icon={ArrowLeftRight}
          gradient="from-orange-500 to-red-600"
        />
      </div>

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
              <label className="text-sm font-medium text-slate-700 mb-1 block">Status da Visita</label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  <SelectItem value="realizada">Realizada</SelectItem>
                  <SelectItem value="nao_realizada">Não Realizada</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Promotor</label>
              <Select value={filtroPromotor} onValueChange={setFiltroPromotor}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os promotores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os promotores</SelectItem>
                  {promotoresUnicos.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Buscar</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Cliente, produto, código..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="visitas" className="w-full">
        <TabsList>
          <TabsTrigger value="visitas">Visitas ({visitasFiltradas.length})</TabsTrigger>
          <TabsTrigger value="estoques">Estoques ({estoquesFiltrados.length})</TabsTrigger>
          <TabsTrigger value="trocas">Trocas ({trocasFiltradas.length})</TabsTrigger>
        </TabsList>

        {/* Visitas */}
        <TabsContent value="visitas">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Visitas Realizadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-slate-200">
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Data</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Cliente</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Local</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Promotor</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Status</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Pedido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitasFiltradas.map((visita, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-3 text-sm">
                          <div className="font-medium text-slate-900">
                            {new Date(visita.data_visita).toLocaleDateString('pt-BR')}
                          </div>
                          <div className="text-xs text-slate-500">
                            {visita.checkin_time && new Date(visita.checkin_time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="p-3 text-sm">
                          <div className="font-medium text-slate-900">{visita.cliente_nome}</div>
                          <div className="text-xs text-slate-500">{visita.cliente_codigo}</div>
                        </td>
                        <td className="p-3 text-sm text-slate-700">
                          <div>{visita.cliente_cidade} - {visita.cliente_uf}</div>
                          {visita.cliente_segmento && (
                            <div className="text-xs text-slate-500">{visita.cliente_segmento}</div>
                          )}
                        </td>
                        <td className="p-3 text-sm text-slate-700">
                          {visita.promotor_nome}
                        </td>
                        <td className="p-3 text-center">
                          <Badge className={
                            visita.status === 'realizada' ? 'bg-green-100 text-green-700' :
                            visita.status === 'nao_realizada' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }>
                            {visita.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          {visita.pedido_solicitado ? (
                            <Badge className="bg-blue-100 text-blue-700">Sim</Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-600">Não</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Estoques */}
        <TabsContent value="estoques">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Registros de Estoque</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-slate-200">
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Data</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Cliente</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Produto</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Qtd</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Validade</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Promotor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estoquesFiltrados.map((estoque, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-3 text-sm text-slate-700">
                          {new Date(estoque.data_registro).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="p-3 text-sm">
                          <div className="font-medium text-slate-900">{estoque.cliente_nome}</div>
                          <div className="text-xs text-slate-500">{estoque.cliente_codigo}</div>
                        </td>
                        <td className="p-3 text-sm">
                          <div className="font-medium text-slate-900">{estoque.produto_descricao}</div>
                          <div className="text-xs text-slate-500">
                            {estoque.produto_codigo} {estoque.produto_gramatura && `• ${estoque.produto_gramatura}`}
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <Badge className="bg-blue-100 text-blue-700">
                            {estoque.quantidade}
                          </Badge>
                        </td>
                        <td className="p-3 text-center text-sm text-slate-700">
                          {estoque.data_validade ? new Date(estoque.data_validade).toLocaleDateString('pt-BR') : '-'}
                        </td>
                        <td className="p-3 text-sm text-slate-700">
                          {estoque.promotor_nome}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trocas */}
        <TabsContent value="trocas">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Trocas Registradas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-slate-200">
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Data</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Cliente</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Produto</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Motivo</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Qtd</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Vida Útil</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Promotor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trocasFiltradas.map((troca, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-3 text-sm text-slate-700">
                          {new Date(troca.data_registro).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="p-3 text-sm">
                          <div className="font-medium text-slate-900">{troca.cliente_nome}</div>
                          <div className="text-xs text-slate-500">{troca.cliente_codigo}</div>
                        </td>
                        <td className="p-3 text-sm">
                          <div className="font-medium text-slate-900">{troca.produto_descricao}</div>
                          <div className="text-xs text-slate-500">{troca.produto_codigo}</div>
                        </td>
                        <td className="p-3 text-sm text-slate-700">
                          {troca.motivo_troca || '-'}
                        </td>
                        <td className="p-3 text-center">
                          <Badge className="bg-orange-100 text-orange-700">
                            {troca.quantidade}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          {troca.dias_vida_util !== null && troca.dias_vida_util !== undefined ? (
                            <Badge className={
                              troca.dias_vida_util < 0 ? 'bg-red-100 text-red-700' :
                              troca.dias_vida_util < 10 ? 'bg-orange-100 text-orange-700' :
                              'bg-green-100 text-green-700'
                            }>
                              {troca.dias_vida_util} dias
                            </Badge>
                          ) : '-'}
                        </td>
                        <td className="p-3 text-sm text-slate-700">
                          {troca.promotor_nome}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}