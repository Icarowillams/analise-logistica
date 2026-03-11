import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  LineChart, Line, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { 
  TrendingUp, Users, MapPin, Filter, Calendar, 
  CheckCircle, XCircle, Clock, Target, Percent, UserCheck, FileText, ChevronDown, RefreshCw
} from 'lucide-react';
import { createPageUrl } from '@/utils';
import StatsCard from '@/components/ui/StatsCard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function AnaliseVisitas() {
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [filtroFuncionarios, setFiltroFuncionarios] = useState([]);
  const [filtroSupervisor, setFiltroSupervisor] = useState('todos');
  const [filtroRota, setFiltroRota] = useState('todos');
  const [filtroFuncoes, setFiltroFuncoes] = useState([]);

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

  const { data: clientesAll = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: funcoes = [] } = useQuery({
    queryKey: ['funcoes'],
    queryFn: () => base44.entities.Funcao.list()
  });

  const { data: reagendamentos = [] } = useQuery({
    queryKey: ['reagendamentos'],
    queryFn: () => base44.entities.VisitaReagendada.list('-data_reagendamento', 5000)
  });

  // Permissões de visibilidade de clientes
  const { filtrarClientes, filtrarPorCliente, filtrarRoteiros, vendedoresPermitidosIds } = useClientesPermissao();

  // Clientes filtrados por permissão
  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);

  // Mapas
  const vendedoresMap = useMemo(() => {
    return vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {});
  }, [vendedores]);

  const rotasMap = useMemo(() => {
    return rotas.reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
  }, [rotas]);

  // Mapa de funcao_id -> nome para lookup
  const funcoesMap = useMemo(() => {
    const m = {};
    funcoes.forEach(f => { m[f.id] = f.nome; });
    return m;
  }, [funcoes]);

  // Lista de supervisores (vendedores que são referenciados como supervisor_id)
  const supervisores = useMemo(() => {
    const supervisorIds = new Set();
    vendedores.forEach(v => {
      if (v.supervisor_id && vendedoresMap[v.supervisor_id]) {
        supervisorIds.add(v.supervisor_id);
      }
    });
    return Array.from(supervisorIds).map(id => vendedoresMap[id]).filter(Boolean);
  }, [vendedores, vendedoresMap]);

  // Vendedores filtrados por função (usa funcao_id se preenchido, senão usa campo legado funcao)
  const vendedoresIdsPorFuncao = useMemo(() => {
    if (filtroFuncoes.length === 0) return null; // sem filtro
    const nomesSelecionados = filtroFuncoes.map(id => funcoesMap[id]?.toLowerCase()).filter(Boolean);
    const ids = new Set();
    vendedores.forEach(v => {
      if (v.funcao_id && filtroFuncoes.includes(v.funcao_id)) {
        ids.add(v.id);
      } else if (!v.funcao_id && v.funcao && nomesSelecionados.includes(v.funcao.toLowerCase())) {
        ids.add(v.id);
      }
    });
    return ids;
  }, [vendedores, filtroFuncoes, funcoesMap]);

  // IDs dos vendedores filtrados por supervisor
  const vendedoresIdsPorSupervisor = useMemo(() => {
    if (filtroSupervisor === 'todos') return null;
    const ids = new Set();
    vendedores.forEach(v => {
      if (v.supervisor_id === filtroSupervisor) {
        ids.add(v.id);
      }
    });
    return ids;
  }, [vendedores, filtroSupervisor]);

  // Combinar todos os filtros de vendedores (funcionários selecionados, função, supervisor)
  const vendedoresIdsFiltrados = useMemo(() => {
    // Se nenhum filtro ativo, retorna null (sem filtro)
    if (filtroFuncionarios.length === 0 && !vendedoresIdsPorFuncao && !vendedoresIdsPorSupervisor) return null;
    
    // Começar com todos os vendedores
    let ids = new Set(vendedores.map(v => v.id));
    
    // Filtrar por funcionários selecionados
    if (filtroFuncionarios.length > 0) {
      ids = new Set(filtroFuncionarios.filter(id => ids.has(id)));
    }
    
    // Filtrar por função
    if (vendedoresIdsPorFuncao) {
      ids = new Set([...ids].filter(id => vendedoresIdsPorFuncao.has(id)));
    }
    
    // Filtrar por supervisor
    if (vendedoresIdsPorSupervisor) {
      ids = new Set([...ids].filter(id => vendedoresIdsPorSupervisor.has(id)));
    }
    
    return ids;
  }, [filtroFuncionarios, vendedoresIdsPorFuncao, vendedoresIdsPorSupervisor, vendedores]);

  // Visitas filtradas por período e vendedor/rota/função (usa VisitaRoteiro para dados de execução)
  const visitasRoteiroFiltradas = useMemo(() => {
    let resultado = visitasRoteiro.filter(v => {
      if (v.data_visita < dataInicio || v.data_visita > dataFim) return false;
      if (filtroRota !== 'todos' && v.roteiro_id !== filtroRota) return false;
      if (vendedoresIdsFiltrados && !vendedoresIdsFiltrados.has(v.vendedor_id)) return false;
      return true;
    });
    return filtrarPorCliente(resultado);
  }, [visitasRoteiro, dataInicio, dataFim, filtroRota, vendedoresIdsFiltrados, filtrarPorCliente]);

  // Manter compatibilidade com visitas da entidade Visita
  const visitasFiltradas = useMemo(() => {
    let resultado = visitas.filter(v => {
      if (v.data_visita < dataInicio || v.data_visita > dataFim) return false;
      if (filtroRota !== 'todos' && v.roteiro_id !== filtroRota) return false;
      if (vendedoresIdsFiltrados && !vendedoresIdsFiltrados.has(v.vendedor_id)) return false;
      return true;
    });
    return filtrarPorCliente(resultado);
  }, [visitas, dataInicio, dataFim, filtroRota, vendedoresIdsFiltrados, filtrarPorCliente]);

  // Roteiros filtrados por permissão de clientes da base
  const roteirosPermitidos = useMemo(() => filtrarRoteiros(roteiros), [roteiros, filtrarRoteiros]);

  // Roteiros filtrados
  const roteirosFiltrados = useMemo(() => {
    return roteirosPermitidos.filter(r => {
      if (vendedoresIdsFiltrados && !vendedoresIdsFiltrados.has(r.vendedor_id)) return false;
      return true;
    });
  }, [roteirosPermitidos, vendedoresIdsFiltrados]);

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

  // Visitas por dia (baseado em VisitaRoteiro) + pendentes do roteiro
  const visitasPorDia = useMemo(() => {
    const map = {};
    visitasRoteiroFiltradas.forEach(v => {
      const data = v.data_visita;
      if (!map[data]) map[data] = { data, realizadas: 0, naoRealizadas: 0, pendentes: 0 };
      
      if (v.status === 'concluida' || v.status === 'checkin_realizado' || v.status === 'em_andamento') {
        map[data].realizadas++;
      } else if (v.status === 'nao_atendido') {
        map[data].naoRealizadas++;
      } else if (v.status === 'pendente') {
        map[data].pendentes++;
      }
    });

    // Calcular pendentes baseados no roteiro para dias que têm visitas mas podem ter clientes não visitados
    const diasNoPeriodo = getDaysInRange(dataInicio, dataFim);
    diasNoPeriodo.forEach(dia => {
      const diaSemana = getDiaSemana(dia);
      let agendadasNoDia = 0;
      roteirosFiltrados.forEach(r => {
        if (r.dia_semana === diaSemana) {
          agendadasNoDia += (r.clientes_ids?.length || 0);
        }
      });
      
      if (agendadasNoDia > 0) {
        if (!map[dia]) map[dia] = { data: dia, realizadas: 0, naoRealizadas: 0, pendentes: 0 };
        const visitadasNoDia = map[dia].realizadas + map[dia].naoRealizadas + map[dia].pendentes;
        // Se há mais agendadas que visitadas, a diferença são pendentes adicionais
        const pendentesDiff = agendadasNoDia - visitadasNoDia;
        if (pendentesDiff > 0) {
          map[dia].pendentes += pendentesDiff;
        }
      }
    });

    return Object.values(map)
      .sort((a, b) => a.data.localeCompare(b.data))
      .slice(-30)
      .map(item => ({
        ...item,
        dataFormatada: new Date(item.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      }));
  }, [visitasRoteiroFiltradas, roteirosFiltrados, dataInicio, dataFim]);

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

  // Mapa de pedido_solicitado da entidade Visita (por chave vendedor+cliente+data)
  const visitaPedidoMap = useMemo(() => {
    const m = {};
    visitasFiltradas.forEach(v => {
      const key = `${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`;
      m[key] = v.pedido_solicitado;
    });
    return m;
  }, [visitasFiltradas]);

  // Reagendamentos filtrados por período e vendedor — com breakdown de status
  const reagendamentosPorVendedor = useMemo(() => {
    const map = {};
    reagendamentos.forEach(r => {
      if (r.data_reagendamento < dataInicio || r.data_reagendamento > dataFim) return;
      if (vendedoresIdsFiltrados && !vendedoresIdsFiltrados.has(r.vendedor_id)) return;
      if (!map[r.vendedor_id]) map[r.vendedor_id] = { total: 0, realizadas: 0, naoRealizadas: 0, emAndamento: 0, pendentes: 0 };
      map[r.vendedor_id].total++;
      
      // Buscar VisitaRoteiro correspondente na data do reagendamento para este cliente/vendedor
      const visitaCorrespondente = visitasRoteiroFiltradas.find(v => 
        v.vendedor_id === r.vendedor_id && 
        v.cliente_id === r.cliente_id && 
        v.data_visita === r.data_reagendamento
      );
      
      if (visitaCorrespondente) {
        if (visitaCorrespondente.status === 'concluida') {
          map[r.vendedor_id].realizadas++;
        } else if (visitaCorrespondente.status === 'nao_atendido') {
          map[r.vendedor_id].naoRealizadas++;
        } else if (visitaCorrespondente.status === 'checkin_realizado' || visitaCorrespondente.status === 'em_andamento') {
          map[r.vendedor_id].emAndamento++;
        } else {
          map[r.vendedor_id].pendentes++;
        }
      } else if (r.status === 'realizada') {
        map[r.vendedor_id].realizadas++;
      } else if (r.status === 'cancelada') {
        map[r.vendedor_id].naoRealizadas++;
      } else {
        map[r.vendedor_id].pendentes++;
      }
    });
    return map;
  }, [reagendamentos, dataInicio, dataFim, vendedoresIdsFiltrados, visitasRoteiroFiltradas]);

  // Tabela de Performance por Funcionário (baseado em VisitaRoteiro)
  const performancePorFuncionario = useMemo(() => {
    const map = {};
    
    // Calcular visitas agendadas por vendedor no período
    const diasNoPeriodo = getDaysInRange(dataInicio, dataFim);
    roteirosFiltrados.forEach(r => {
      const vendedorId = r.vendedor_id;
      if (!map[vendedorId]) {
        map[vendedorId] = {
          vendedorId,
          nome: vendedoresMap[vendedorId]?.nome || 'Sem Nome',
          agendadas: 0,
          realizadas: 0,
          naoRealizadas: 0,
          emAndamento: 0,
          pendentes: 0,
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
          vendedorId,
          nome: vendedoresMap[vendedorId]?.nome || v.vendedor_nome || 'Sem Nome',
          agendadas: 0,
          realizadas: 0,
          naoRealizadas: 0,
          emAndamento: 0,
          pendentes: 0,
          comPedido: 0,
          semPedido: 0
        };
      }
      
      if (v.status === 'concluida') {
        map[vendedorId].realizadas++;
      } else if (v.status === 'nao_atendido') {
        map[vendedorId].naoRealizadas++;
      } else if (v.status === 'checkin_realizado' || v.status === 'em_andamento') {
        map[vendedorId].emAndamento++;
      } else if (v.status === 'pendente') {
        map[vendedorId].pendentes++;
      }
      
      // Buscar pedido_solicitado: primeiro tenta do VisitaRoteiro, senão cruza com Visita
      const pedido = v.pedido_solicitado != null 
        ? v.pedido_solicitado 
        : visitaPedidoMap[`${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`];
      
      // Contar apenas para visitas atendidas (concluída, checkin, em_andamento)
      if (v.status === 'concluida' || v.status === 'checkin_realizado' || v.status === 'em_andamento') {
        if (pedido === true) {
          map[vendedorId].comPedido++;
        } else if (pedido === false) {
          map[vendedorId].semPedido++;
        }
      }
    });

    // Calcular pendentes adicionais e reagendamentos
    Object.keys(map).forEach(vendedorId => {
      const item = map[vendedorId];
      const totalComRegistro = item.realizadas + item.naoRealizadas + item.emAndamento + item.pendentes;
      const pendentesDiff = item.agendadas - totalComRegistro;
      if (pendentesDiff > 0) {
        item.pendentes += pendentesDiff;
      }
      // reagendamentos are now shown as a separate row
    });
    
    return Object.values(map)
      .filter(item => item.agendadas > 0 || item.realizadas > 0)
      .sort((a, b) => b.agendadas - a.agendadas);
  }, [visitasRoteiroFiltradas, roteirosFiltrados, vendedoresMap, dataInicio, dataFim, visitaPedidoMap, reagendamentosPorVendedor]);

  const limparFiltros = () => {
    const d = new Date();
    d.setDate(1);
    setDataInicio(d.toISOString().split('T')[0]);
    setDataFim(new Date().toISOString().split('T')[0]);
    setFiltroFuncionarios([]);
    setFiltroSupervisor('todos');
    setFiltroRota('todos');
    setFiltroFuncoes([]);
  };

  const toggleFuncao = (funcaoId) => {
    setFiltroFuncoes(prev => 
      prev.includes(funcaoId) 
        ? prev.filter(id => id !== funcaoId) 
        : [...prev, funcaoId]
    );
  };

  const toggleFuncionario = (vendedorId) => {
    setFiltroFuncionarios(prev => 
      prev.includes(vendedorId) 
        ? prev.filter(id => id !== vendedorId) 
        : [...prev, vendedorId]
    );
  };

  // Lista de funcionários para o filtro (respeitando permissões e filtro de supervisor)
  const funcionariosParaFiltro = useMemo(() => {
    let lista = vendedores.filter(v => vendedoresPermitidosIds === null || vendedoresPermitidosIds.has(v.id));
    if (filtroSupervisor !== 'todos') {
      lista = lista.filter(v => v.supervisor_id === filtroSupervisor);
    }
    return lista.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  }, [vendedores, vendedoresPermitidosIds, filtroSupervisor]);

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
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Início</label>
              <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Fim</label>
              <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Supervisor</label>
              <Select value={filtroSupervisor} onValueChange={(val) => { setFiltroSupervisor(val); setFiltroFuncionarios([]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {supervisores.sort((a, b) => (a.nome || '').localeCompare(b.nome || '')).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Funcionário</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal">
                    {filtroFuncionarios.length === 0 
                      ? 'Todos' 
                      : `${filtroFuncionarios.length} selecionado(s)`}
                    <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {funcionariosParaFiltro.map(v => (
                      <div 
                        key={v.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-slate-50 cursor-pointer"
                        onClick={() => toggleFuncionario(v.id)}
                      >
                        <Checkbox checked={filtroFuncionarios.includes(v.id)} />
                        <span className="text-sm">{v.nome}</span>
                      </div>
                    ))}
                  </div>
                  {filtroFuncionarios.length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full mt-2 text-xs"
                      onClick={() => setFiltroFuncionarios([])}
                    >
                      Limpar seleção
                    </Button>
                  )}
                </PopoverContent>
              </Popover>
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
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Função</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal">
                    {filtroFuncoes.length === 0 
                      ? 'Todas' 
                      : `${filtroFuncoes.length} selecionada(s)`}
                    <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {funcoes.filter(f => f.status === 'ativo').map(f => (
                      <div 
                        key={f.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-slate-50 cursor-pointer"
                        onClick={() => toggleFuncao(f.id)}
                      >
                        <Checkbox checked={filtroFuncoes.includes(f.id)} />
                        <span className="text-sm">{f.nome}</span>
                      </div>
                    ))}
                  </div>
                  {filtroFuncoes.length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full mt-2 text-xs"
                      onClick={() => setFiltroFuncoes([])}
                    >
                      Limpar seleção
                    </Button>
                  )}
                </PopoverContent>
              </Popover>
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

      {/* Evolução Diária de Visitas - largura total */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600" />
            <CardTitle className="text-lg">Evolução Diária de Visitas</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={visitasPorDia}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dataFormatada" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="realizadas" name="Realizadas" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="naoRealizadas" name="Não Realizadas" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="pendentes" name="Pendentes" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabela de Performance por Funcionário */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-orange-600" />
              <CardTitle className="text-lg">Tabela de Performance por Funcionário</CardTitle>
            </div>
            {performancePorFuncionario.length > 0 && (
              <Button
                size="sm"
                className="bg-gradient-to-r from-orange-500 to-red-600 text-white gap-1.5"
                onClick={() => {
                  const ids = performancePorFuncionario.map(p => p.vendedorId).join(',');
                  window.location.href = createPageUrl('RelatorioDetalhadoVisitas') + 
                    `&vendedor_ids=${ids}&data_inicio=${dataInicio}&data_fim=${dataFim}`;
                }}
              >
                <FileText className="w-4 h-4" />
                Relatório Geral
              </Button>
            )}
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
                  <TableHead className="font-semibold text-center text-amber-600">Em Andamento</TableHead>
                  <TableHead className="font-semibold text-center text-yellow-600">Pendentes</TableHead>
                  <TableHead className="font-semibold text-center text-blue-600">Com Pedido</TableHead>
                  <TableHead className="font-semibold text-center text-orange-600">Sem Pedido</TableHead>
                  <TableHead className="font-semibold text-center">Relatório</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performancePorFuncionario.map((item, index) => {
                  const reag = reagendamentosPorVendedor[item.vendedorId];
                  return (
                    <React.Fragment key={index}>
                      {/* Linha principal do vendedor */}
                      <TableRow className="hover:bg-slate-50">
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
                          <span className="text-amber-600 font-medium">{item.emAndamento}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-yellow-600 font-medium">{item.pendentes}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-blue-600 font-medium">{item.comPedido}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-orange-600 font-medium">{item.semPedido}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-orange-600 hover:text-orange-800 hover:bg-orange-50 gap-1"
                            onClick={() => {
                              window.location.href = createPageUrl('RelatorioDetalhadoVisitas') + 
                                `&vendedor_id=${item.vendedorId}&data_inicio=${dataInicio}&data_fim=${dataFim}`;
                            }}
                          >
                            <FileText className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {/* Linha de reagendamento */}
                      {reag && reag.total > 0 && (
                        <TableRow className="bg-purple-50/50 hover:bg-purple-50">
                          <TableCell></TableCell>
                          <TableCell>
                            <span className="text-purple-700 font-medium text-xs flex items-center gap-1">
                              <RefreshCw className="w-3 h-3" />
                              Reagendamento
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-purple-600 font-medium">{reag.total}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-green-600 font-medium">{reag.realizadas}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-red-600 font-medium">{reag.naoRealizadas}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-amber-600 font-medium">{reag.emAndamento}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-yellow-600 font-medium">{reag.pendentes}</span>
                          </TableCell>
                          <TableCell className="text-center">—</TableCell>
                          <TableCell className="text-center">—</TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
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