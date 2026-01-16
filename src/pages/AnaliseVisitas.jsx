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

  // Visitas filtradas por período e vendedor/rota (usa VisitaRoteiro para dados de execução)
  const visitasRoteiroFiltradas = useMemo(() => {
    return visitasRoteiro.filter(v => {
      if (v.data_visita < dataInicio || v.data_visita > dataFim) return false;
      if (filtroVendedor !== 'todos' && v.vendedor_id !== filtroVendedor) return false;
      if (filtroRota !== 'todos' && v.roteiro_id !== filtroRota) return false;
      return true;
    });
  }, [visitasRoteiro, dataInicio, dataFim, filtroVendedor, filtroRota]);

  // Manter compatibilidade com visitas da entidade Visita
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

  // ========== KPIs (baseados em VisitaRoteiro para dados de execução) ==========

  // Calcular total de visitas agendadas no período
  const totalAgendadas = useMemo(() => {
    const diasNoPeriodo = getDaysInRange(dataInicio, dataFim);
    let total = 0;
    diasNoPeriodo.forEach(dia => {
      const diaSemana = getDiaSemana(dia);
      roteirosFiltrados.forEach(r => {
        if (r.dia_semana === diaSemana) {
          total += (r.clientes_ids?.length || 0);
        }
      });
    });
    return total;
  }, [roteirosFiltrados, dataInicio, dataFim]);

  // Visitas realizadas (status concluida ou checkin_realizado)
  const visitasRealizadas = useMemo(() => {
    return visitasRoteiroFiltradas.filter(v => 
      v.status === 'concluida' || v.status === 'checkin_realizado' || v.status === 'em_andamento'
    );
  }, [visitasRoteiroFiltradas]);

  // Visitas não atendidas
  const visitasNaoAtendidas = useMemo(() => {
    return visitasRoteiroFiltradas.filter(v => v.status === 'nao_atendido');
  }, [visitasRoteiroFiltradas]);

  // Visitas em andamento
  const visitasEmAndamento = useMemo(() => {
    return visitasRoteiroFiltradas.filter(v => v.status === 'em_andamento' || v.status === 'checkin_realizado');
  }, [visitasRoteiroFiltradas]);

  // 1. Taxa de Conclusão (realizadas / agendadas)
  const taxaConclusao = useMemo(() => {
    if (totalAgendadas === 0) return 0;
    return ((visitasRealizadas.length / totalAgendadas) * 100).toFixed(1);
  }, [visitasRealizadas, totalAgendadas]);

  // 2. Visitas com pedido solicitado
  const visitasComPedido = useMemo(() => {
    return visitasRoteiroFiltradas.filter(v => v.pedido_solicitado === true);
  }, [visitasRoteiroFiltradas]);

  // 3. Visitas sem pedido
  const visitasSemPedido = useMemo(() => {
    return visitasRoteiroFiltradas.filter(v => v.pedido_solicitado === false);
  }, [visitasRoteiroFiltradas]);

  // 4. Tempo Médio por Visita
  const tempoMedioPorVisita = useMemo(() => {
    const visitasComTempo = visitasRoteiroFiltradas.filter(v => v.checkin_time && v.checkout_time);
    if (visitasComTempo.length === 0) return 'N/D';
    
    let totalMinutos = 0;
    visitasComTempo.forEach(v => {
      const checkin = new Date(v.checkin_time);
      const checkout = new Date(v.checkout_time);
      const diff = (checkout - checkin) / 60000; // em minutos
      if (diff > 0 && diff < 480) { // máximo 8 horas para evitar outliers
        totalMinutos += diff;
      }
    });
    
    if (totalMinutos === 0) return 'N/D';
    const media = totalMinutos / visitasComTempo.length;
    return `${Math.round(media)} min`;
  }, [visitasRoteiroFiltradas]);

  // 5. Clientes únicos atendidos
  const clientesAtendidos = useMemo(() => {
    const uniqueClientes = new Set(visitasRealizadas.map(v => v.cliente_id));
    return uniqueClientes.size;
  }, [visitasRealizadas]);

  // Stats resumidos para KPIs
  const stats = useMemo(() => ({
    totalAgendadas,
    totalRealizadas: visitasRealizadas.length,
    totalNaoAtendidas: visitasNaoAtendidas.length,
    totalEmAndamento: visitasEmAndamento.length,
    comPedido: visitasComPedido.length,
    semPedido: visitasSemPedido.length,
    clientesAtendidos
  }), [totalAgendadas, visitasRealizadas, visitasNaoAtendidas, visitasEmAndamento, visitasComPedido, visitasSemPedido, clientesAtendidos]);

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

  // Visitas por dia (baseado em VisitaRoteiro)
  const visitasPorDia = useMemo(() => {
    const map = {};
    visitasRoteiroFiltradas.forEach(v => {
      const data = v.data_visita;
      if (!map[data]) map[data] = { data, realizadas: 0, naoRealizadas: 0 };
      
      if (v.status === 'concluida' || v.status === 'checkin_realizado' || v.status === 'em_andamento') {
        map[data].realizadas++;
      } else if (v.status === 'nao_atendido') {
        map[data].naoRealizadas++;
      }
    });

    return Object.values(map)
      .sort((a, b) => a.data.localeCompare(b.data))
      .slice(-30)
      .map(item => ({
        ...item,
        dataFormatada: new Date(item.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      }));
  }, [visitasRoteiroFiltradas]);

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

  // Distribuição de visitas por status
  const distribuicaoVisitas = useMemo(() => [
    { name: 'Realizadas', value: stats.totalRealizadas, color: '#10b981' },
    { name: 'Não Realizadas', value: stats.totalNaoAtendidas, color: '#ef4444' }
  ].filter(item => item.value > 0), [stats]);

  // Tabela de Performance por Funcionário (baseado em VisitaRoteiro)
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
    
    // Contar visitas do VisitaRoteiro
    visitasRoteiroFiltradas.forEach(v => {
      const vendedorId = v.vendedor_id || 'sem_vendedor';
      if (!map[vendedorId]) {
        map[vendedorId] = {
          nome: vendedoresMap[vendedorId]?.nome || v.vendedor_nome || 'Sem Nome',
          agendadas: 0,
          realizadas: 0,
          naoRealizadas: 0,
          comPedido: 0,
          semPedido: 0
        };
      }
      
      // Contar como realizada se status for concluida, checkin_realizado ou em_andamento
      if (v.status === 'concluida' || v.status === 'checkin_realizado' || v.status === 'em_andamento') {
        map[vendedorId].realizadas++;
      } else if (v.status === 'nao_atendido') {
        map[vendedorId].naoRealizadas++;
      }
      
      if (v.pedido_solicitado === true) map[vendedorId].comPedido++;
      if (v.pedido_solicitado === false) map[vendedorId].semPedido++;
    });
    
    return Object.values(map)
      .filter(item => item.agendadas > 0 || item.realizadas > 0)
      .sort((a, b) => b.agendadas - a.agendadas);
  }, [visitasRoteiroFiltradas, roteirosFiltrados, vendedoresMap, dataInicio, dataFim]);

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
          title="Visitas Agendadas"
          value={stats.totalAgendadas}
          subtitle="no período"
          icon={Calendar}
          gradient="from-blue-500 to-indigo-600"
        />
        <StatsCard
          title="Taxa de Conclusão"
          value={`${taxaConclusao}%`}
          subtitle={`${stats.totalRealizadas} realizadas`}
          icon={Target}
          gradient="from-yellow-500 to-amber-600"
        />
        <StatsCard
          title="Visitas Realizadas"
          value={stats.totalRealizadas}
          subtitle="clique para detalhes"
          icon={CheckCircle}
          gradient="from-green-500 to-emerald-600"
        />
        <StatsCard
          title="Não Realizadas"
          value={stats.totalNaoAtendidas}
          subtitle="clique para detalhes"
          icon={XCircle}
          gradient="from-red-500 to-rose-600"
        />
        <StatsCard
          title="Em Andamento"
          value={stats.totalEmAndamento}
          subtitle={tempoMedioPorVisita !== 'N/D' ? `tempo médio: ${tempoMedioPorVisita}` : 'sem tempo médio'}
          icon={Clock}
          gradient="from-orange-500 to-amber-600"
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
                <Line type="monotone" dataKey="realizadas" name="Realizado" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="naoRealizadas" name="Não Realizado" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Distribuição de Visitas */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-purple-600" />
              <CardTitle className="text-lg">Distribuição de Visitas</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={distribuicaoVisitas} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={120} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" name="Quantidade">
                  {distribuicaoVisitas.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
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