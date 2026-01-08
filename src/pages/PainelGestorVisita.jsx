import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Route, Users, MapPin, Filter, Search, CheckCircle, XCircle, Clock, Eye, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function PainelGestorVisita() {
  const [filtroDia, setFiltroDia] = useState('todos');
  const [filtroVendedor, setFiltroVendedor] = useState('todos');
  const [filtroData, setFiltroData] = useState('');
  const [busca, setBusca] = useState('');
  const [roteiroSelecionado, setRoteiroSelecionado] = useState(null);

  // Buscar dados das entidades locais
  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteiros'],
    queryFn: () => base44.entities.Roteiro.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitas'],
    queryFn: () => base44.entities.Visita.list()
  });

  const { data: visitasRoteiro = [] } = useQuery({
    queryKey: ['visitasRoteiro'],
    queryFn: () => base44.entities.VisitaRoteiro.list()
  });

  // Mapear vendedores
  const vendedoresMap = useMemo(() => {
    return vendedores.reduce((acc, v) => {
      acc[v.id] = v;
      return acc;
    }, {});
  }, [vendedores]);

  // Mapear clientes
  const clientesMap = useMemo(() => {
    return clientes.reduce((acc, c) => {
      acc[c.id] = c;
      return acc;
    }, {});
  }, [clientes]);

  // Vendedores únicos para filtro
  const vendedoresUnicos = useMemo(() => {
    const ids = new Set();
    roteiros.forEach(r => {
      if (r.vendedor_id) ids.add(r.vendedor_id);
    });
    return Array.from(ids).map(id => vendedoresMap[id]).filter(Boolean).sort((a, b) => a.nome?.localeCompare(b.nome));
  }, [roteiros, vendedoresMap]);

  // Dias únicos para filtro
  const diasSemana = [
    { valor: 'segunda-feira', label: 'Segunda-feira' },
    { valor: 'terca-feira', label: 'Terça-feira' },
    { valor: 'quarta-feira', label: 'Quarta-feira' },
    { valor: 'quinta-feira', label: 'Quinta-feira' },
    { valor: 'sexta-feira', label: 'Sexta-feira' },
    { valor: 'sabado', label: 'Sábado' },
    { valor: 'domingo', label: 'Domingo' }
  ];

  // Roteiros com dados enriquecidos
  const roteirosEnriquecidos = useMemo(() => {
    return roteiros.map(r => {
      const vendedor = vendedoresMap[r.vendedor_id];
      const clientesDoRoteiro = (r.clientes_ids || []).map(id => clientesMap[id]).filter(Boolean);
      
      // Contar visitas realizadas para este roteiro
      const visitasDoRoteiro = visitasRoteiro.filter(v => v.roteiro_id === r.id);
      const visitasHoje = visitasDoRoteiro.filter(v => v.data_visita === new Date().toISOString().split('T')[0]);
      
      return {
        ...r,
        vendedor_nome: vendedor?.nome || 'N/A',
        vendedor,
        clientes_detalhes: clientesDoRoteiro,
        total_clientes: clientesDoRoteiro.length,
        visitas_realizadas: visitasHoje.length,
        visitas_totais: visitasDoRoteiro.length
      };
    });
  }, [roteiros, vendedoresMap, clientesMap, visitasRoteiro]);

  // Roteiros filtrados
  const roteirosFiltrados = useMemo(() => {
    return roteirosEnriquecidos.filter(r => {
      if (filtroDia !== 'todos' && r.dia_semana !== filtroDia) return false;
      if (filtroVendedor !== 'todos' && r.vendedor_id !== filtroVendedor) return false;
      if (busca) {
        const termo = busca.toLowerCase();
        return (
          r.vendedor_nome?.toLowerCase().includes(termo) ||
          r.dia_semana?.toLowerCase().includes(termo)
        );
      }
      return true;
    });
  }, [roteirosEnriquecidos, filtroDia, filtroVendedor, busca]);

  // Estatísticas de visitas
  const statsVisitas = useMemo(() => {
    const hoje = new Date().toISOString().split('T')[0];
    const visitasHoje = visitas.filter(v => v.data_visita === hoje);
    const pedidosSolicitados = visitasHoje.filter(v => v.pedido_solicitado === true).length;
    const pedidosNaoSolicitados = visitasHoje.filter(v => v.pedido_solicitado === false).length;

    return {
      totalRoteiros: roteirosFiltrados.length,
      totalVendedores: new Set(roteirosFiltrados.map(r => r.vendedor_id).filter(Boolean)).size,
      totalClientes: roteirosFiltrados.reduce((sum, r) => sum + r.total_clientes, 0),
      visitasHoje: visitasHoje.length,
      pedidosSolicitados,
      pedidosNaoSolicitados
    };
  }, [roteirosFiltrados, visitas]);

  // Roteiros por dia da semana
  const roteirosPorDia = useMemo(() => {
    const diasOrdem = diasSemana.map(d => d.valor);
    const grouped = {};
    diasOrdem.forEach(d => grouped[d] = 0);
    
    roteirosFiltrados.forEach(r => {
      if (r.dia_semana && grouped[r.dia_semana] !== undefined) {
        grouped[r.dia_semana]++;
      }
    });
    
    return diasOrdem.map(dia => {
      const label = diasSemana.find(d => d.valor === dia)?.label || dia;
      return { dia: label.substring(0, 3), qtd: grouped[dia] };
    });
  }, [roteirosFiltrados]);

  // Roteiros por vendedor
  const roteirosPorVendedor = useMemo(() => {
    const grouped = {};
    roteirosFiltrados.forEach(r => {
      const vendedor = r.vendedor_nome || 'Sem vendedor';
      grouped[vendedor] = (grouped[vendedor] || 0) + 1;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([nome, qtd]) => ({ nome: nome.split(' ')[0], qtd }));
  }, [roteirosFiltrados]);

  // Visitas por status (pedido solicitado ou não)
  const visitasPorStatus = useMemo(() => {
    const hoje = new Date().toISOString().split('T')[0];
    const visitasHoje = visitas.filter(v => v.data_visita === hoje);
    
    return [
      { nome: 'Solicitados', qtd: visitasHoje.filter(v => v.pedido_solicitado === true).length },
      { nome: 'Não Solicitados', qtd: visitasHoje.filter(v => v.pedido_solicitado === false).length },
      { nome: 'Não Informado', qtd: visitasHoje.filter(v => v.pedido_solicitado === null).length }
    ];
  }, [visitas]);

  const getDiaLabel = (valor) => {
    return diasSemana.find(d => d.valor === valor)?.label || valor;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
            <Route className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Painel de Roteiros</h1>
            <p className="text-slate-500">Gestão e acompanhamento de roteiros e visitas</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatsCard
          title="Roteiros"
          value={statsVisitas.totalRoteiros}
          subtitle="cadastrados"
          icon={Route}
          gradient="from-yellow-400 to-amber-500"
        />
        <StatsCard
          title="Vendedores"
          value={statsVisitas.totalVendedores}
          subtitle="com roteiros"
          icon={Users}
          gradient="from-blue-400 to-blue-500"
        />
        <StatsCard
          title="Clientes"
          value={statsVisitas.totalClientes}
          subtitle="nos roteiros"
          icon={MapPin}
          gradient="from-purple-400 to-purple-500"
        />
        <StatsCard
          title="Visitas Hoje"
          value={statsVisitas.visitasHoje}
          subtitle="realizadas"
          icon={CheckCircle}
          gradient="from-green-400 to-green-500"
        />
        <StatsCard
          title="Pedidos OK"
          value={statsVisitas.pedidosSolicitados}
          subtitle="solicitados"
          icon={CheckCircle}
          gradient="from-emerald-400 to-emerald-500"
        />
        <StatsCard
          title="Sem Pedido"
          value={statsVisitas.pedidosNaoSolicitados}
          subtitle="não solicitados"
          icon={XCircle}
          gradient="from-red-400 to-red-500"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="roteiros" className="w-full">
        <TabsList>
          <TabsTrigger value="roteiros">Roteiros</TabsTrigger>
          <TabsTrigger value="visitas">Visitas do Dia</TabsTrigger>
          <TabsTrigger value="pendentes">Visitas Pendentes</TabsTrigger>
          <TabsTrigger value="graficos">Análises</TabsTrigger>
        </TabsList>

        <TabsContent value="roteiros" className="space-y-4">
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
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Dia da Semana</label>
                  <Select value={filtroDia} onValueChange={setFiltroDia}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos os dias" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os dias</SelectItem>
                      {diasSemana.map(dia => (
                        <SelectItem key={dia.valor} value={dia.valor}>{dia.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Vendedor</label>
                  <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos os vendedores" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os vendedores</SelectItem>
                      {vendedoresUnicos.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
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
              <CardTitle className="text-base">Roteiros ({roteirosFiltrados.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-slate-200">
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Dia</th>
                      <th className="text-left p-3 text-sm font-semibold text-slate-700">Vendedor</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Clientes</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Visitas Hoje</th>
                      <th className="text-center p-3 text-sm font-semibold text-slate-700">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roteirosFiltrados.map((roteiro) => (
                      <tr key={roteiro.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-3 text-sm text-slate-700 font-medium">
                          {getDiaLabel(roteiro.dia_semana)}
                        </td>
                        <td className="p-3 text-sm text-slate-700">
                          {roteiro.vendedor_nome}
                        </td>
                        <td className="p-3 text-center">
                          <Badge className="bg-slate-100 text-slate-700">
                            {roteiro.total_clientes} clientes
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          <Badge className={roteiro.visitas_realizadas > 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}>
                            {roteiro.visitas_realizadas} / {roteiro.total_clientes}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRoteiroSelecionado(roteiro)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Ver
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="visitas" className="space-y-4">
          <VisitasDoDia visitas={visitas} vendedoresMap={vendedoresMap} clientesMap={clientesMap} />
        </TabsContent>

        <TabsContent value="graficos" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="text-base">Roteiros por Dia da Semana</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={roteirosPorDia}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="dia" tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="qtd" fill="#fbbf24" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="text-base">Roteiros por Vendedor</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={roteirosPorVendedor} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} />
                    <YAxis dataKey="nome" type="category" tick={{ fill: '#64748b', fontSize: 10 }} width={80} />
                    <Tooltip />
                    <Bar dataKey="qtd" fill="#f59e0b" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Status dos Pedidos (Hoje)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={visitasPorStatus}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="nome" tick={{ fill: '#64748b', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="qtd" fill="#6366f1" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal de Detalhes do Roteiro */}
      <Dialog open={!!roteiroSelecionado} onOpenChange={() => setRoteiroSelecionado(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Roteiro - {getDiaLabel(roteiroSelecionado?.dia_semana)} - {roteiroSelecionado?.vendedor_nome}
            </DialogTitle>
          </DialogHeader>
          {roteiroSelecionado && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-500">Total de Clientes:</span>
                  <p className="font-semibold">{roteiroSelecionado.total_clientes}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-500">Visitas Realizadas:</span>
                  <p className="font-semibold">{roteiroSelecionado.visitas_totais}</p>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">Clientes do Roteiro:</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {roteiroSelecionado.clientes_detalhes?.map((cliente, idx) => (
                    <div key={cliente.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                      <Badge className="bg-amber-500 text-white">{idx + 1}</Badge>
                      <div>
                        <p className="font-medium text-sm">{cliente.razao_social || cliente.nome_fantasia}</p>
                        <p className="text-xs text-slate-500">{cliente.codigo} • {cliente.cidade}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VisitasDoDia({ visitas, vendedoresMap, clientesMap }) {
  const hoje = new Date().toISOString().split('T')[0];
  const [filtroVendedor, setFiltroVendedor] = useState('todos');
  
  const visitasHoje = useMemo(() => {
    return visitas
      .filter(v => v.data_visita === hoje)
      .filter(v => filtroVendedor === 'todos' || v.vendedor_id === filtroVendedor)
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  }, [visitas, hoje, filtroVendedor]);

  const vendedoresComVisitas = useMemo(() => {
    const ids = new Set(visitas.filter(v => v.data_visita === hoje).map(v => v.vendedor_id));
    return Array.from(ids).map(id => vendedoresMap[id]).filter(Boolean);
  }, [visitas, hoje, vendedoresMap]);

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Visitas de Hoje ({visitasHoje.length})</CardTitle>
          <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filtrar vendedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {vendedoresComVisitas.map(v => (
                <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="text-left p-3 text-sm font-semibold text-slate-700">Nº Visita</th>
                <th className="text-left p-3 text-sm font-semibold text-slate-700">Vendedor</th>
                <th className="text-left p-3 text-sm font-semibold text-slate-700">Cliente</th>
                <th className="text-center p-3 text-sm font-semibold text-slate-700">Hora</th>
                <th className="text-center p-3 text-sm font-semibold text-slate-700">Pedido</th>
                <th className="text-left p-3 text-sm font-semibold text-slate-700">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {visitasHoje.map((visita) => (
                <tr key={visita.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-3 text-xs font-mono text-slate-600">
                    {visita.numero_visita?.substring(0, 15) || '-'}
                  </td>
                  <td className="p-3 text-sm text-slate-700">
                    {visita.vendedor_nome || vendedoresMap[visita.vendedor_id]?.nome || 'N/A'}
                  </td>
                  <td className="p-3 text-sm text-slate-700">
                    {visita.cliente_nome || clientesMap[visita.cliente_id]?.razao_social || 'N/A'}
                  </td>
                  <td className="p-3 text-center text-sm">
                    <Badge variant="outline">
                      <Clock className="w-3 h-3 mr-1" />
                      {visita.hora_checkin?.substring(0, 5) || '-'}
                    </Badge>
                  </td>
                  <td className="p-3 text-center">
                    {visita.pedido_solicitado === true && (
                      <Badge className="bg-green-100 text-green-700">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Sim
                      </Badge>
                    )}
                    {visita.pedido_solicitado === false && (
                      <Badge className="bg-red-100 text-red-700">
                        <XCircle className="w-3 h-3 mr-1" />
                        Não
                      </Badge>
                    )}
                    {visita.pedido_solicitado === null && (
                      <Badge className="bg-slate-100 text-slate-500">-</Badge>
                    )}
                  </td>
                  <td className="p-3 text-sm text-slate-600">
                    {visita.motivo_nao_solicitacao_descricao || '-'}
                  </td>
                </tr>
              ))}
              {visitasHoje.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    Nenhuma visita registrada hoje
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}