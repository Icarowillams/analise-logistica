import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { 
  TrendingUp, Users, MapPin, Filter, Calendar, 
  CheckCircle, XCircle, Clock, Target, Percent, UserCheck, FileText
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function AnaliseVisitas() {
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [filtroVendedor, setFiltroVendedor] = useState('todos');
  const [filtroRota, setFiltroRota] = useState('todos');

  // Visita = registro de contabilização, VisitaRoteiro = registro de execução do roteiro
  const { data: visitas = [] } = useQuery({
    queryKey: ['visitas'],
    queryFn: () => base44.entities.Visita.list('-data_visita', 5000)
  });

  const { data: visitasRoteiro = [] } = useQuery({
    queryKey: ['visitasRoteiro'],
    queryFn: () => base44.entities.VisitaRoteiro.list('-data_visita', 5000)
  });

  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteiros'],
    queryFn: () => base44.entities.Roteiro.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas'],
    queryFn: () => base44.entities.Rota.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  // Mapas
  const vendedoresMap = useMemo(() => {
    return vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {});
  }, [vendedores]);

  const rotasMap = useMemo(() => {
    return rotas.reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
  }, [rotas]);

  // Visitas filtradas por período e vendedor/rota
  const visitasFiltradas = useMemo(() => {
    return visitas.filter(v => {
      if (v.data_visita < dataInicio || v.data_visita > dataFim) return false;
      if (filtroVendedor !== 'todos' && v.vendedor_id !== filtroVendedor) return false;
      if (filtroRota !== 'todos' && v.roteiro_id !== filtroRota) return false;
      return true;
    });
  }, [visitas, dataInicio, dataFim, filtroVendedor, filtroRota]);

  // Roteiros filtrados
  const roteirosFiltrados = useMemo(() => {
    return roteiros.filter(r => {
      if (filtroVendedor !== 'todos' && r.vendedor_id !== filtroVendedor) return false;
      return true;
    });
  }, [roteiros, filtroVendedor]);

  // ========== KPIs ==========

  // 1. Conversão de Pedido por Visita
  const taxaConversao = useMemo(() => {
    const total = visitasFiltradas.length;
    if (total === 0) return 0;
    const comPedido = visitasFiltradas.filter(v => v.pedido_solicitado === true).length;
    return ((comPedido / total) * 100).toFixed(1);
  }, [visitasFiltradas]);

  // 2. Taxa de Não Solicitação de Pedidos
  const taxaNaoSolicitacao = useMemo(() => {
    const total = visitasFiltradas.length;
    if (total === 0) return 0;
    const semPedido = visitasFiltradas.filter(v => v.pedido_solicitado === false).length;
    return ((semPedido / total) * 100).toFixed(1);
  }, [visitasFiltradas]);

  // 3. Taxa de Não Atendimento (clientes programados vs visitados)
  const taxaNaoAtendimento = useMemo(() => {
    // Calcular quantos clientes deveriam ser visitados no período
    const diasNoPeriodo = getDaysInRange(dataInicio, dataFim);
    let totalProgramados = 0;
    let totalVisitados = new Set();

    diasNoPeriodo.forEach(dia => {
      const diaSemana = getDiaSemana(dia);
      const roteirosNoDia = roteirosFiltrados.filter(r => r.dia_semana === diaSemana);
      roteirosNoDia.forEach(r => {
        totalProgramados += (r.clientes_ids?.length || 0);
      });
    });

    visitasFiltradas.forEach(v => {
      totalVisitados.add(`${v.cliente_id}_${v.data_visita}`);
    });

    if (totalProgramados === 0) return 0;
    const naoAtendidos = totalProgramados - totalVisitados.size;
    return ((naoAtendidos / totalProgramados) * 100).toFixed(1);
  }, [roteirosFiltrados, visitasFiltradas, dataInicio, dataFim]);

  // 4. Tempo Médio por Visita (se houver hora_checkin e hora_checkout)
  const tempoMedioPorVisita = useMemo(() => {
    const visitasComTempo = visitasFiltradas.filter(v => v.hora_checkin);
    if (visitasComTempo.length === 0) return 'N/D';
    // Se não há checkout, retorna N/D
    return 'N/D';
  }, [visitasFiltradas]);

  // 5. Quantidade de Clientes Atendidos
  const clientesAtendidos = useMemo(() => {
    const uniqueClientes = new Set(visitasFiltradas.map(v => v.cliente_id));
    return uniqueClientes.size;
  }, [visitasFiltradas]);

  // Stats resumidos
  const stats = useMemo(() => ({
    totalVisitas: visitasFiltradas.length,
    comPedido: visitasFiltradas.filter(v => v.pedido_solicitado === true).length,
    semPedido: visitasFiltradas.filter(v => v.pedido_solicitado === false).length,
    clientesAtendidos
  }), [visitasFiltradas, clientesAtendidos]);

  // ========== Dados para Gráficos ==========

  // Conversão por vendedor
  const conversaoPorVendedor = useMemo(() => {
    const map = {};
    visitasFiltradas.forEach(v => {
      const vendedorId = v.vendedor_id || 'sem_vendedor';
      if (!map[vendedorId]) {
        map[vendedorId] = { total: 0, comPedido: 0, nome: vendedoresMap[vendedorId]?.nome || 'Sem Vendedor' };
      }
      map[vendedorId].total++;
      if (v.pedido_solicitado === true) map[vendedorId].comPedido++;
    });

    return Object.values(map)
      .map(item => ({
        nome: item.nome.split(' ')[0],
        taxa: item.total > 0 ? parseFloat(((item.comPedido / item.total) * 100).toFixed(1)) : 0,
        visitas: item.total
      }))
      .sort((a, b) => b.taxa - a.taxa)
      .slice(0, 10);
  }, [visitasFiltradas, vendedoresMap]);

  // Visitas por dia
  const visitasPorDia = useMemo(() => {
    const map = {};
    visitasFiltradas.forEach(v => {
      const data = v.data_visita;
      if (!map[data]) map[data] = { data, total: 0, comPedido: 0, semPedido: 0 };
      map[data].total++;
      if (v.pedido_solicitado === true) map[data].comPedido++;
      if (v.pedido_solicitado === false) map[data].semPedido++;
    });

    return Object.values(map)
      .sort((a, b) => a.data.localeCompare(b.data))
      .slice(-30)
      .map(item => ({
        ...item,
        dataFormatada: new Date(item.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      }));
  }, [visitasFiltradas]);

  // Clientes por vendedor
  const clientesPorVendedor = useMemo(() => {
    const map = {};
    visitasFiltradas.forEach(v => {
      const vendedorId = v.vendedor_id || 'sem_vendedor';
      if (!map[vendedorId]) {
        map[vendedorId] = { nome: vendedoresMap[vendedorId]?.nome || 'Sem Vendedor', clientes: new Set() };
      }
      map[vendedorId].clientes.add(v.cliente_id);
    });

    return Object.values(map)
      .map(item => ({
        nome: item.nome.split(' ')[0],
        clientes: item.clientes.size
      }))
      .sort((a, b) => b.clientes - a.clientes)
      .slice(0, 10);
  }, [visitasFiltradas, vendedoresMap]);

  // Distribuição de status de pedido
  const distribuicaoPedidos = useMemo(() => [
    { name: 'Com Pedido', value: stats.comPedido, color: '#10b981' },
    { name: 'Sem Pedido', value: stats.semPedido, color: '#ef4444' },
    { name: 'Não Informado', value: stats.totalVisitas - stats.comPedido - stats.semPedido, color: '#94a3b8' }
  ], [stats]);

  // Tabela de Performance por Funcionário
  const performancePorFuncionario = useMemo(() => {
    const map = {};
    
    // Calcular visitas agendadas por vendedor no período
    const diasNoPeriodo = getDaysInRange(dataInicio, dataFim);
    roteirosFiltrados.forEach(r => {
      const vendedorId = r.vendedor_id;
      if (!map[vendedorId]) {
        map[vendedorId] = {
          nome: vendedoresMap[vendedorId]?.nome || 'Sem Nome',
          agendadas: 0,
          realizadas: 0,
          naoRealizadas: 0,
          comPedido: 0,
          semPedido: 0
        };
      }
      diasNoPeriodo.forEach(dia => {
        const diaSemana = getDiaSemana(dia);
        if (r.dia_semana === diaSemana) {
          map[vendedorId].agendadas += (r.clientes_ids?.length || 0);
        }
      });
    });
    
    // Contar visitas realizadas
    visitasFiltradas.forEach(v => {
      const vendedorId = v.vendedor_id || 'sem_vendedor';
      if (!map[vendedorId]) {
        map[vendedorId] = {
          nome: vendedoresMap[vendedorId]?.nome || 'Sem Nome',
          agendadas: 0,
          realizadas: 0,
          naoRealizadas: 0,
          comPedido: 0,
          semPedido: 0
        };
      }
      map[vendedorId].realizadas++;
      if (v.pedido_solicitado === true) map[vendedorId].comPedido++;
      if (v.pedido_solicitado === false) map[vendedorId].semPedido++;
    });
    
    // Calcular não realizadas
    Object.values(map).forEach(item => {
      item.naoRealizadas = Math.max(0, item.agendadas - item.realizadas);
    });
    
    return Object.values(map).sort((a, b) => b.agendadas - a.agendadas);
  }, [visitasFiltradas, roteirosFiltrados, vendedoresMap, dataInicio, dataFim]);

  const limparFiltros = () => {
    const d = new Date();
    d.setDate(1);
    setDataInicio(d.toISOString().split('T')[0]);
    setDataFim(new Date().toISOString().split('T')[0]);
    setFiltroVendedor('todos');
    setFiltroRota('todos');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-xl">
          <TrendingUp className="h-7 w-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Análise de Visitas</h1>
          <p className="text-slate-500 mt-1">KPIs e indicadores de desempenho de rota e visita</p>
        </div>
      </div>

      {/* Filtros */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-slate-600" />
              <CardTitle className="text-base">Filtros</CardTitle>
            </div>
            <Button variant="ghost" size="sm" onClick={limparFiltros}>Limpar Filtros</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Início</label>
              <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Fim</label>
              <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Vendedor</label>
              <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {vendedores.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Rota</label>
              <Select value={filtroRota} onValueChange={setFiltroRota}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  {rotas.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatsCard
          title="Conversão de Pedido"
          value={`${taxaConversao}%`}
          subtitle={`${stats.comPedido} de ${stats.totalVisitas} visitas`}
          icon={Target}
          gradient="from-green-500 to-emerald-600"
        />
        <StatsCard
          title="Tx. Não Solicitação"
          value={`${taxaNaoSolicitacao}%`}
          subtitle="visitas sem pedido"
          icon={XCircle}
          gradient="from-red-500 to-rose-600"
        />
        <StatsCard
          title="Tx. Não Atendimento"
          value={`${taxaNaoAtendimento}%`}
          subtitle="clientes não visitados"
          icon={Clock}
          gradient="from-orange-500 to-amber-600"
        />
        <StatsCard
          title="Tempo Médio/Visita"
          value={tempoMedioPorVisita}
          subtitle="por atendimento"
          icon={Clock}
          gradient="from-blue-500 to-cyan-600"
        />
        <StatsCard
          title="Clientes Atendidos"
          value={clientesAtendidos}
          subtitle="no período"
          icon={UserCheck}
          gradient="from-purple-500 to-indigo-600"
        />
      </div>

      {/* Gráficos lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Evolução Diária de Visitas */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-600" />
              <CardTitle className="text-lg">Evolução Diária de Visitas</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={visitasPorDia}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dataFormatada" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="comPedido" name="Realizado" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="semPedido" name="Não Realizado" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Distribuição de Pedidos */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-purple-600" />
              <CardTitle className="text-lg">Distribuição de Pedidos</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={distribuicaoPedidos}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {distribuicaoPedidos.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de Performance por Funcionário */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-orange-600" />
            <CardTitle className="text-lg">Tabela de Performance por Funcionário</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="font-semibold">#</TableHead>
                  <TableHead className="font-semibold">Funcionário</TableHead>
                  <TableHead className="font-semibold text-center">Agendadas</TableHead>
                  <TableHead className="font-semibold text-center text-green-600">Realizadas</TableHead>
                  <TableHead className="font-semibold text-center text-red-600">Não Realizadas</TableHead>
                  <TableHead className="font-semibold text-center text-blue-600">Com Pedido</TableHead>
                  <TableHead className="font-semibold text-center text-orange-600">Sem Pedido</TableHead>
                  <TableHead className="font-semibold text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performancePorFuncionario.map((item, index) => (
                  <TableRow key={index} className="hover:bg-slate-50">
                    <TableCell>
                      <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300">
                        {index + 1}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{item.nome}</TableCell>
                    <TableCell className="text-center">{item.agendadas}</TableCell>
                    <TableCell className="text-center">
                      <span className="text-green-600 font-medium">{item.realizadas}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-red-600 font-medium">{item.naoRealizadas}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-blue-600 font-medium">{item.comPedido}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-orange-600 font-medium">{item.semPedido}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50">
                        <FileText className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Funções auxiliares
function getDaysInRange(start, end) {
  const days = [];
  const startDate = new Date(start);
  const endDate = new Date(end);
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d).toISOString().split('T')[0]);
  }
  return days;
}

function getDiaSemana(dateStr) {
  const dias = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];
  const d = new Date(dateStr + 'T12:00:00');
  return dias[d.getDay()];
}