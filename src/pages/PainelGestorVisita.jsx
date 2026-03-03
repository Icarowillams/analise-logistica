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
import { Route, Users, MapPin, Filter, Search, CheckCircle, XCircle, Clock, Eye, ChevronLeft, ChevronRight, AlertTriangle, Calendar, ChevronDown, ChevronUp, ShoppingCart, Percent } from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import MultiSelectFilter from '@/components/ui/MultiSelectFilter';

export default function PainelGestorVisita() {
  const [filtroDiasSemana, setFiltroDiasSemana] = useState([]);
  const [filtroFuncionarios, setFiltroFuncionarios] = useState([]);
  const [filtroFuncoes, setFiltroFuncoes] = useState([]);
  const [filtroSupervisores, setFiltroSupervisores] = useState([]);
  const [filtroDataInicio, setFiltroDataInicio] = useState('');
  const [filtroDataFim, setFiltroDataFim] = useState('');
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

  const { data: funcoes = [] } = useQuery({
    queryKey: ['funcoes'],
    queryFn: () => base44.entities.Funcao.list()
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

  // Mapear funções
  const funcoesMap = useMemo(() => {
    return funcoes.reduce((acc, f) => {
      acc[f.id] = f;
      return acc;
    }, {});
  }, [funcoes]);

  // Mapear clientes
  const clientesMap = useMemo(() => {
    return clientes.reduce((acc, c) => {
      acc[c.id] = c;
      return acc;
    }, {});
  }, [clientes]);

  const clientesMapByCodigo = useMemo(() => {
    return clientes.reduce((acc, c) => {
      if (c.codigo) acc[c.codigo] = c;
      return acc;
    }, {});
  }, [clientes]);

  // Funcionários para filtro (com roteiros)
  const funcionariosParaFiltro = useMemo(() => {
    const ids = new Set();
    roteiros.forEach(r => {
      if (r.vendedor_id) ids.add(r.vendedor_id);
    });
    return Array.from(ids)
      .map(id => vendedoresMap[id])
      .filter(Boolean)
      .sort((a, b) => a.nome?.localeCompare(b.nome));
  }, [roteiros, vendedoresMap]);

  // Funções para filtro - mostra todas as funções ativas
  const funcoesParaFiltro = useMemo(() => {
    return funcoes
      .filter(f => f.status !== 'inativo')
      .sort((a, b) => a.nome?.localeCompare(b.nome));
  }, [funcoes]);

  // Supervisores para filtro - todos os vendedores que são supervisores de alguém
  const supervisoresParaFiltro = useMemo(() => {
    const supervisoresIds = new Set();
    vendedores.forEach(v => {
      if (v.supervisor_id) supervisoresIds.add(v.supervisor_id);
    });
    return Array.from(supervisoresIds)
      .map(id => vendedoresMap[id])
      .filter(Boolean)
      .sort((a, b) => a.nome?.localeCompare(b.nome));
  }, [vendedores, vendedoresMap]);

  // Dias únicos para filtro
  const diasSemana = [
    { id: 'segunda-feira', nome: 'Segunda-feira' },
    { id: 'terca-feira', nome: 'Terça-feira' },
    { id: 'quarta-feira', nome: 'Quarta-feira' },
    { id: 'quinta-feira', nome: 'Quinta-feira' },
    { id: 'sexta-feira', nome: 'Sexta-feira' },
    { id: 'sabado', nome: 'Sábado' },
    { id: 'domingo', nome: 'Domingo' }
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
      // Filtro por dia da semana (multi-select)
      if (filtroDiasSemana.length > 0 && !filtroDiasSemana.includes(r.dia_semana)) return false;
      
      // Filtro por funcionário (multi-select)
      if (filtroFuncionarios.length > 0 && !filtroFuncionarios.includes(r.vendedor_id)) return false;
      
      // Filtro por função (multi-select) - verifica por funcao_id ou pelo nome legado
      if (filtroFuncoes.length > 0) {
        const funcionario = vendedoresMap[r.vendedor_id];
        if (!funcionario) return false;
        
        // Verificar por funcao_id ou pelo campo texto legado 'funcao'
        const funcaoMatch = filtroFuncoes.some(funcaoId => {
          // Primeiro tenta por ID
          if (funcionario.funcao_id === funcaoId) return true;
          // Se não tiver funcao_id, tenta pelo nome da função no campo legado
          const funcaoSelecionada = funcoesMap[funcaoId];
          if (funcaoSelecionada && funcionario.funcao?.toLowerCase() === funcaoSelecionada.nome?.toLowerCase()) {
            return true;
          }
          return false;
        });
        
        if (!funcaoMatch) return false;
      }
      
      // Filtro por supervisor (multi-select)
      if (filtroSupervisores.length > 0) {
        const funcionario = vendedoresMap[r.vendedor_id];
        if (!funcionario || !filtroSupervisores.includes(funcionario.supervisor_id)) return false;
      }
      
      // Busca textual
      if (busca) {
        const termo = busca.toLowerCase();
        return (
          r.vendedor_nome?.toLowerCase().includes(termo) ||
          r.dia_semana?.toLowerCase().includes(termo)
        );
      }
      return true;
    });
  }, [roteirosEnriquecidos, filtroDiasSemana, filtroFuncionarios, filtroFuncoes, filtroSupervisores, busca, vendedoresMap, funcoesMap]);

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
    const diasOrdem = diasSemana.map(d => d.id);
    const grouped = {};
    diasOrdem.forEach(d => grouped[d] = 0);
    
    roteirosFiltrados.forEach(r => {
      if (r.dia_semana && grouped[r.dia_semana] !== undefined) {
        grouped[r.dia_semana]++;
      }
    });
    
    return diasOrdem.map(dia => {
      const label = diasSemana.find(d => d.id === dia)?.nome || dia;
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
    return diasSemana.find(d => d.id === valor)?.nome || valor;
  };

  const limparFiltros = () => {
    setFiltroDiasSemana([]);
    setFiltroFuncionarios([]);
    setFiltroFuncoes([]);
    setFiltroSupervisores([]);
    setFiltroDataInicio('');
    setFiltroDataFim('');
    setBusca('');
  };

  const temFiltrosAtivos = filtroDiasSemana.length > 0 || filtroFuncionarios.length > 0 || 
    filtroFuncoes.length > 0 || filtroSupervisores.length > 0 || filtroDataInicio || filtroDataFim || busca;

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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="w-5 h-5 text-slate-600" />
                  <CardTitle className="text-base">Filtros</CardTitle>
                </div>
                {temFiltrosAtivos && (
                  <Button variant="ghost" size="sm" onClick={limparFiltros} className="text-amber-600 hover:text-amber-700">
                    Limpar filtros
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Dia da Semana</label>
                  <MultiSelectFilter
                    options={diasSemana}
                    selectedIds={filtroDiasSemana}
                    onChange={setFiltroDiasSemana}
                    placeholder="Todos os dias"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Funcionário</label>
                  <MultiSelectFilter
                    options={funcionariosParaFiltro}
                    selectedIds={filtroFuncionarios}
                    onChange={setFiltroFuncionarios}
                    placeholder="Todos os funcionários"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Função</label>
                  <MultiSelectFilter
                    options={funcoesParaFiltro}
                    selectedIds={filtroFuncoes}
                    onChange={setFiltroFuncoes}
                    placeholder="Todas as funções"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Supervisor</label>
                  <MultiSelectFilter
                    options={supervisoresParaFiltro}
                    selectedIds={filtroSupervisores}
                    onChange={setFiltroSupervisores}
                    placeholder="Todos os supervisores"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Período - Início</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      type="date"
                      value={filtroDataInicio}
                      onChange={(e) => setFiltroDataInicio(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">Período - Fim</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      type="date"
                      value={filtroDataFim}
                      onChange={(e) => setFiltroDataFim(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="lg:col-span-2">
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

          {/* Lista por Funcionário */}
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Roteiros por Funcionário ({roteirosFiltrados.length} roteiros)</CardTitle>
            </CardHeader>
            <CardContent>
              <RoteirosPorFuncionario 
                roteiros={roteirosFiltrados} 
                vendedoresMap={vendedoresMap}
                funcoesMap={funcoesMap}
                getDiaLabel={getDiaLabel}
                onVerRoteiro={setRoteiroSelecionado}
                visitasRoteiro={visitasRoteiro}
                clientesMap={clientesMap}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="visitas" className="space-y-4">
          <VisitasDoDia visitas={visitas} vendedoresMap={vendedoresMap} clientesMap={clientesMap} />
        </TabsContent>

        <TabsContent value="pendentes" className="space-y-4">
          <VisitasPendentesCalendario 
            roteiros={roteirosEnriquecidos} 
            visitas={visitas} 
            vendedoresMap={vendedoresMap} 
            clientesMap={clientesMap}
          />
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
                  {roteiroSelecionado.clientes_detalhes?.map((cliente, idx) => {
                    const clienteCompleto = (cliente.codigo ? clientesMapByCodigo[cliente.codigo] : undefined) || clientesMap[cliente.id];
                    const nome = clienteCompleto?.nome_fantasia || clienteCompleto?.razao_social || cliente.nome_fantasia || cliente.razao_social;
                    return (
                    <div key={cliente.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                      <Badge className="bg-amber-500 text-white">{idx + 1}</Badge>
                      <div>
                        <p className="font-medium text-sm">{nome}</p>
                        <p className="text-xs text-slate-500">{clienteCompleto?.codigo || cliente.codigo} • {clienteCompleto?.cidade || cliente.cidade}</p>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VisitasPendentesCalendario({ roteiros, visitas, vendedoresMap, clientesMap }) {
  const [mesAtual, setMesAtual] = useState(new Date());
  const [diaSelecionado, setDiaSelecionado] = useState(null);
  const [filtroVendedor, setFiltroVendedor] = useState('todos');

  // Vendedores únicos com roteiros
  const vendedoresComRoteiros = useMemo(() => {
    const ids = new Set(roteiros.map(r => r.vendedor_id).filter(Boolean));
    return Array.from(ids).map(id => vendedoresMap[id]).filter(Boolean).sort((a, b) => a.nome?.localeCompare(b.nome));
  }, [roteiros, vendedoresMap]);

  // Roteiros filtrados por vendedor
  const roteirosFiltrados = useMemo(() => {
    if (filtroVendedor === 'todos') return roteiros;
    return roteiros.filter(r => r.vendedor_id === filtroVendedor);
  }, [roteiros, filtroVendedor]);

  const diasSemanaMap = {
    0: 'domingo',
    1: 'segunda-feira',
    2: 'terca-feira',
    3: 'quarta-feira',
    4: 'quinta-feira',
    5: 'sexta-feira',
    6: 'sabado'
  };

  const diasSemanaNomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  // Gerar dias do mês
  const diasDoMes = useMemo(() => {
    const ano = mesAtual.getFullYear();
    const mes = mesAtual.getMonth();
    const primeiroDia = new Date(ano, mes, 1);
    const ultimoDia = new Date(ano, mes + 1, 0);
    const dias = [];

    // Dias do mês anterior para preencher a primeira semana
    const primeiroDiaSemana = primeiroDia.getDay();
    for (let i = primeiroDiaSemana - 1; i >= 0; i--) {
      const dia = new Date(ano, mes, -i);
      dias.push({ data: dia, outroMes: true });
    }

    // Dias do mês atual
    for (let d = 1; d <= ultimoDia.getDate(); d++) {
      dias.push({ data: new Date(ano, mes, d), outroMes: false });
    }

    // Dias do próximo mês para completar a última semana
    const diasRestantes = 42 - dias.length;
    for (let i = 1; i <= diasRestantes; i++) {
      dias.push({ data: new Date(ano, mes + 1, i), outroMes: true });
    }

    return dias;
  }, [mesAtual]);

  // Calcular visitas pendentes por dia
  const visitasPorDia = useMemo(() => {
    const resultado = {};
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    diasDoMes.forEach(({ data, outroMes }) => {
      if (outroMes) return;
      
      const dataStr = data.toISOString().split('T')[0];
      const diaSemana = diasSemanaMap[data.getDay()];
      
      // Roteiros programados para esse dia da semana (aplicando filtro de vendedor)
      const roteirosDoDia = roteirosFiltrados.filter(r => r.dia_semana === diaSemana);
      
      // Visitas que foram feitas nesse dia
      const visitasFeitas = visitas.filter(v => v.data_visita === dataStr);
      const clientesVisitados = new Set(visitasFeitas.map(v => v.cliente_id));

      // Clientes que deveriam ter sido visitados (pendentes para passado, programados para futuro)
      const pendentes = [];
      roteirosDoDia.forEach(roteiro => {
        (roteiro.clientes_ids || []).forEach(clienteId => {
          if (!clientesVisitados.has(clienteId)) {
            pendentes.push({
              cliente_id: clienteId,
              cliente: clientesMap[clienteId],
              vendedor_id: roteiro.vendedor_id,
              vendedor: vendedoresMap[roteiro.vendedor_id],
              roteiro
            });
          }
        });
      });

      const dataComparacao = new Date(data);
      dataComparacao.setHours(0, 0, 0, 0);
      const isPast = dataComparacao < hoje;
      const isToday = dataComparacao.getTime() === hoje.getTime();
      
      resultado[dataStr] = {
        total: roteirosDoDia.reduce((sum, r) => sum + (r.clientes_ids?.length || 0), 0),
        realizadas: visitasFeitas.length,
        pendentes: pendentes, // Sempre incluir pendentes, independente do dia
        isPast,
        isToday,
        isFuture: !isPast && !isToday
      };
    });

    return resultado;
  }, [diasDoMes, roteirosFiltrados, visitas, clientesMap, vendedoresMap]);

  // Visitas pendentes do dia selecionado agrupadas por vendedor
  const visitasPorVendedor = useMemo(() => {
    if (!diaSelecionado) return {};
    const dataStr = diaSelecionado.toISOString().split('T')[0];
    const pendentes = visitasPorDia[dataStr]?.pendentes || [];
    
    // Agrupar por vendedor
    const agrupado = {};
    pendentes.forEach(item => {
      const vendedorId = item.vendedor_id || 'sem_vendedor';
      if (!agrupado[vendedorId]) {
        agrupado[vendedorId] = {
          vendedor: item.vendedor,
          clientes: []
        };
      }
      agrupado[vendedorId].clientes.push(item);
    });
    
    return agrupado;
  }, [diaSelecionado, visitasPorDia]);

  const infoDiaSelecionado = useMemo(() => {
    if (!diaSelecionado) return null;
    const dataStr = diaSelecionado.toISOString().split('T')[0];
    return visitasPorDia[dataStr];
  }, [diaSelecionado, visitasPorDia]);

  const navegarMes = (direcao) => {
    setMesAtual(prev => new Date(prev.getFullYear(), prev.getMonth() + direcao, 1));
    setDiaSelecionado(null);
  };

  const getCorDia = (data) => {
    const dataStr = data.toISOString().split('T')[0];
    const info = visitasPorDia[dataStr];
    if (!info || info.total === 0) return 'bg-slate-50';
    if (info.isFuture) return 'bg-blue-50 border-blue-200';
    if (info.pendentes.length === 0) return 'bg-green-100 border-green-300';
    if (info.pendentes.length < info.total / 2) return 'bg-yellow-100 border-yellow-300';
    return 'bg-red-100 border-red-300';
  };

  const totalPendentes = Object.values(visitasPorVendedor).reduce((sum, v) => sum + v.clientes.length, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendário */}
      <Card className="border-0 shadow-lg lg:col-span-2">
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Calendário de Visitas Pendentes
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navegarMes(-1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="font-semibold text-slate-700 min-w-[150px] text-center">
                  {mesesNomes[mesAtual.getMonth()]} {mesAtual.getFullYear()}
                </span>
                <Button variant="outline" size="sm" onClick={() => navegarMes(1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
            {/* Filtro de vendedor */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Filtrar por vendedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os vendedores</SelectItem>
                  {vendedoresComRoteiros.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filtroVendedor !== 'todos' && (
                <Button variant="ghost" size="sm" onClick={() => setFiltroVendedor('todos')}>
                  Limpar
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Legenda */}
          <div className="flex flex-wrap gap-4 mb-4 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-green-100 border border-green-300"></div>
              <span>100% realizadas</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-yellow-100 border border-yellow-300"></div>
              <span>Parcialmente realizadas</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-red-100 border border-red-300"></div>
              <span>Muitas pendentes</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-blue-50 border border-blue-200"></div>
              <span>Programadas (futuro)</span>
            </div>
          </div>

          {/* Header do calendário */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {diasSemanaNomes.map(dia => (
              <div key={dia} className="text-center text-xs font-semibold text-slate-500 py-2">
                {dia}
              </div>
            ))}
          </div>

          {/* Grid do calendário */}
          <div className="grid grid-cols-7 gap-1">
            {diasDoMes.map(({ data, outroMes }, idx) => {
              const dataStr = data.toISOString().split('T')[0];
              const info = visitasPorDia[dataStr];
              const isSelected = diaSelecionado?.toISOString().split('T')[0] === dataStr;
              const isHoje = new Date().toISOString().split('T')[0] === dataStr;

              return (
                <button
                  key={idx}
                  onClick={() => !outroMes && setDiaSelecionado(data)}
                  disabled={outroMes}
                  className={`
                    p-2 rounded-lg text-center transition-all min-h-[70px] border
                    ${outroMes ? 'opacity-30 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:shadow-md'}
                    ${!outroMes && getCorDia(data)}
                    ${isSelected ? 'ring-2 ring-amber-500 ring-offset-2' : ''}
                    ${isHoje ? 'ring-2 ring-blue-500' : ''}
                  `}
                >
                  <div className={`text-sm font-medium ${outroMes ? 'text-slate-400' : 'text-slate-700'}`}>
                    {data.getDate()}
                  </div>
                  {!outroMes && info && info.total > 0 && (
                    <div className="mt-1 space-y-0.5">
                      <div className="text-[10px] text-slate-500">{info.realizadas}/{info.total}</div>
                      {info.pendentes.length > 0 && (
                        <Badge className={`text-[10px] px-1 py-0 ${info.isFuture ? 'bg-blue-500' : 'bg-red-500'} text-white`}>
                          {info.pendentes.length} {info.isFuture ? 'prog' : 'pend'}
                        </Badge>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Painel de detalhes por vendedor */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-base">
            {diaSelecionado 
              ? infoDiaSelecionado?.isFuture 
                ? `Programadas - ${diaSelecionado.toLocaleDateString('pt-BR')}`
                : `Pendentes - ${diaSelecionado.toLocaleDateString('pt-BR')}`
              : 'Selecione um dia'
            }
          </CardTitle>
          {diaSelecionado && totalPendentes > 0 && (
            <p className="text-sm text-slate-500">
              {totalPendentes} cliente(s) • {Object.keys(visitasPorVendedor).length} vendedor(es)
            </p>
          )}
        </CardHeader>
        <CardContent>
          {!diaSelecionado ? (
            <div className="text-center text-slate-400 py-8">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Clique em um dia no calendário para ver as visitas pendentes ou programadas</p>
            </div>
          ) : totalPendentes === 0 ? (
            <div className="text-center py-8">
              {infoDiaSelecionado?.total === 0 ? (
                <div className="text-slate-400">
                  <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">Nenhum roteiro programado para este dia</p>
                </div>
              ) : (
                <div className="text-green-600">
                  <CheckCircle className="w-12 h-12 mx-auto mb-3" />
                  <p className="font-medium">Todas as visitas foram realizadas!</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 max-h-[500px] overflow-y-auto">
              {Object.entries(visitasPorVendedor).map(([vendedorId, { vendedor, clientes }]) => (
                <div key={vendedorId} className="border rounded-lg overflow-hidden">
                  {/* Header do vendedor */}
                  <div className={`p-3 ${infoDiaSelecionado?.isFuture ? 'bg-blue-100' : 'bg-amber-100'} flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-slate-700" />
                      <span className="font-semibold text-sm text-slate-800">
                        {vendedor?.nome || 'Vendedor não encontrado'}
                      </span>
                    </div>
                    <Badge className={`${infoDiaSelecionado?.isFuture ? 'bg-blue-500' : 'bg-red-500'} text-white text-xs`}>
                      {clientes.length} cliente(s)
                    </Badge>
                  </div>
                  
                  {/* Lista de clientes */}
                  <div className="divide-y divide-slate-100">
                    {clientes.map((item, idx) => (
                      <div key={idx} className={`p-3 ${infoDiaSelecionado?.isFuture ? 'bg-blue-50/50' : 'bg-red-50/50'}`}>
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-sm text-slate-800">
                              {item.cliente?.nome_fantasia || item.cliente?.razao_social || 'Cliente não encontrado'}
                            </p>
                            <p className="text-xs text-slate-500">
                              {item.cliente?.codigo} • {item.cliente?.cidade}
                            </p>
                          </div>
                          <Badge className={`text-xs ${infoDiaSelecionado?.isFuture ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                            {infoDiaSelecionado?.isFuture ? (
                              <><Clock className="w-3 h-3 mr-1" />Programada</>
                            ) : (
                              <><XCircle className="w-3 h-3 mr-1" />Pendente</>
                            )}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RoteirosPorFuncionario({ roteiros, vendedoresMap, funcoesMap, getDiaLabel, onVerRoteiro, visitasRoteiro, clientesMap }) {
  const [expandedFuncionarios, setExpandedFuncionarios] = useState({});
  const [expandedDias, setExpandedDias] = useState({});

  const toggleFuncionario = (funcionarioId) => {
    setExpandedFuncionarios(prev => ({ ...prev, [funcionarioId]: !prev[funcionarioId] }));
  };

  const toggleDia = (key) => {
    setExpandedDias(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Agrupar por funcionário primeiro, depois por dia
  const dadosPorFuncionario = useMemo(() => {
    const hoje = new Date().toISOString().split('T')[0];
    const porFuncionario = {};
    
    roteiros.forEach(r => {
      const funcionarioId = r.vendedor_id || 'sem_funcionario';
      const funcionario = vendedoresMap[funcionarioId];
      const funcao = funcionario?.funcao_id ? funcoesMap[funcionario.funcao_id] : null;
      const supervisor = funcionario?.supervisor_id ? vendedoresMap[funcionario.supervisor_id] : null;
      
      if (!porFuncionario[funcionarioId]) {
        porFuncionario[funcionarioId] = {
          funcionario,
          funcao,
          supervisor,
          dias: [],
          totais: { clientes: 0, atendidos: 0, naoAtendidos: 0, pendentes: 0, comPedido: 0, semPedido: 0 }
        };
      }
      
      // Dados do dia
      const clientesIds = r.clientes_ids || [];
      const totalClientes = clientesIds.length;
      const visitasDoRoteiro = visitasRoteiro.filter(v => v.roteiro_id === r.id && v.data_visita === hoje);
      
      const clientesAtendidos = visitasDoRoteiro.filter(v => v.status === 'concluida');
      const clientesNaoAtendidos = visitasDoRoteiro.filter(v => v.status === 'nao_atendido');
      const clientesPendentes = clientesIds.filter(cId => {
        const visita = visitasDoRoteiro.find(v => v.cliente_id === cId);
        return !visita || visita.status === 'pendente' || visita.status === 'checkin_realizado';
      });
      const clientesComPedido = visitasDoRoteiro.filter(v => v.pedido_solicitado === true);
      const clientesSemPedido = visitasDoRoteiro.filter(v => v.pedido_solicitado === false && v.status === 'concluida');
      
      const taxaAtendimento = totalClientes > 0 ? ((clientesAtendidos.length / totalClientes) * 100).toFixed(1) : 0;
      const taxaNaoAtendimento = totalClientes > 0 ? ((clientesNaoAtendidos.length / totalClientes) * 100).toFixed(1) : 0;
      const taxaPendencia = totalClientes > 0 ? ((clientesPendentes.length / totalClientes) * 100).toFixed(1) : 0;
      
      const detalhesClientes = {
        atendidos: clientesAtendidos.map(v => ({ ...v, cliente: clientesMap[v.cliente_id] })),
        naoAtendidos: clientesNaoAtendidos.map(v => ({ ...v, cliente: clientesMap[v.cliente_id] })),
        pendentes: clientesPendentes.map(cId => ({
          cliente_id: cId,
          cliente: clientesMap[cId],
          visita: visitasDoRoteiro.find(v => v.cliente_id === cId)
        }))
      };
      
      porFuncionario[funcionarioId].dias.push({
        key: `${funcionarioId}-${r.dia_semana}`,
        dia_semana: r.dia_semana,
        totalClientes,
        atendidos: clientesAtendidos.length,
        naoAtendidos: clientesNaoAtendidos.length,
        pendentes: clientesPendentes.length,
        comPedido: clientesComPedido.length,
        semPedido: clientesSemPedido.length,
        taxaAtendimento,
        taxaNaoAtendimento,
        taxaPendencia,
        detalhesClientes,
        roteiro: r
      });
      
      // Acumular totais
      porFuncionario[funcionarioId].totais.clientes += totalClientes;
      porFuncionario[funcionarioId].totais.atendidos += clientesAtendidos.length;
      porFuncionario[funcionarioId].totais.naoAtendidos += clientesNaoAtendidos.length;
      porFuncionario[funcionarioId].totais.pendentes += clientesPendentes.length;
      porFuncionario[funcionarioId].totais.comPedido += clientesComPedido.length;
      porFuncionario[funcionarioId].totais.semPedido += clientesSemPedido.length;
    });
    
    // Ordenar dias dentro de cada funcionário
    Object.values(porFuncionario).forEach(f => {
      f.dias.sort((a, b) => (a.dia_semana || '').localeCompare(b.dia_semana || ''));
      // Calcular taxas totais
      f.totais.taxaAtendimento = f.totais.clientes > 0 ? ((f.totais.atendidos / f.totais.clientes) * 100).toFixed(1) : 0;
      f.totais.taxaNaoAtendimento = f.totais.clientes > 0 ? ((f.totais.naoAtendidos / f.totais.clientes) * 100).toFixed(1) : 0;
      f.totais.taxaPendencia = f.totais.clientes > 0 ? ((f.totais.pendentes / f.totais.clientes) * 100).toFixed(1) : 0;
    });
    
    return Object.entries(porFuncionario)
      .sort(([, a], [, b]) => (a.funcionario?.nome || 'ZZZ').localeCompare(b.funcionario?.nome || 'ZZZ'));
  }, [roteiros, vendedoresMap, funcoesMap, visitasRoteiro, clientesMap]);

  if (roteiros.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>Nenhum roteiro encontrado com os filtros aplicados</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {dadosPorFuncionario.map(([funcionarioId, data]) => (
        <Collapsible 
          key={funcionarioId} 
          open={expandedFuncionarios[funcionarioId]} 
          onOpenChange={() => toggleFuncionario(funcionarioId)}
        >
          <div className="border rounded-xl overflow-hidden shadow-sm">
            {/* Header do Funcionário */}
            <CollapsibleTrigger asChild>
              <div className="p-4 bg-gradient-to-r from-amber-50 to-yellow-50 hover:from-amber-100 hover:to-yellow-100 cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center text-white font-bold">
                      {data.funcionario?.nome?.charAt(0) || '?'}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">
                        {data.funcionario?.nome || 'Funcionário não encontrado'}
                      </h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        {data.funcao && (
                          <Badge variant="outline" className="text-xs bg-white">
                            {data.funcao.nome}
                          </Badge>
                        )}
                        {data.supervisor && (
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                            Sup: {data.supervisor.nome}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {/* Totais do funcionário */}
                    <div className="hidden md:flex items-center gap-2">
                      <Badge variant="outline" className="bg-white">{data.totais.clientes} clientes</Badge>
                      <Badge className="bg-green-100 text-green-700">{data.totais.atendidos} at.</Badge>
                      <Badge className="bg-red-100 text-red-700">{data.totais.naoAtendidos} não at.</Badge>
                      <Badge className="bg-yellow-100 text-yellow-700">{data.totais.pendentes} pend.</Badge>
                      <span className="text-xs font-semibold text-green-600">
                        {data.totais.taxaAtendimento}%
                      </span>
                    </div>
                    <Badge className="bg-amber-500 text-white">
                      {data.dias.length} dia(s)
                    </Badge>
                    {expandedFuncionarios[funcionarioId] ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
                  </div>
                </div>
                
                {/* Mobile totais */}
                <div className="md:hidden mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline" className="bg-white">{data.totais.clientes} clientes</Badge>
                  <Badge className="bg-green-100 text-green-700">{data.totais.atendidos} at.</Badge>
                  <Badge className="bg-red-100 text-red-700">{data.totais.naoAtendidos} não at.</Badge>
                  <Badge className="bg-yellow-100 text-yellow-700">{data.totais.pendentes} pend.</Badge>
                </div>
              </div>
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <div className="border-t">
                {/* Header da tabela de dias */}
                <div className="hidden md:grid md:grid-cols-11 gap-2 p-3 bg-slate-100 text-xs font-semibold text-slate-600">
                  <div className="col-span-1 text-center">Dia</div>
                  <div className="col-span-1 text-center">Clientes</div>
                  <div className="col-span-1 text-center">Atendidos</div>
                  <div className="col-span-1 text-center">Não Atend.</div>
                  <div className="col-span-1 text-center">Pendentes</div>
                  <div className="col-span-1 text-center">% Atend.</div>
                  <div className="col-span-1 text-center">% Não At.</div>
                  <div className="col-span-1 text-center">% Pend.</div>
                  <div className="col-span-3 text-center">Ações</div>
                </div>
                
                {/* Dias do funcionário */}
                {data.dias.map((dia) => (
                  <Collapsible 
                    key={dia.key} 
                    open={expandedDias[dia.key]} 
                    onOpenChange={() => toggleDia(dia.key)}
                  >
                    <div className="border-t">
                      <CollapsibleTrigger asChild>
                        <div className="p-3 bg-white hover:bg-slate-50 cursor-pointer">
                          {/* Desktop */}
                          <div className="hidden md:grid md:grid-cols-11 gap-2 items-center">
                            <div className="col-span-1 text-center">
                              <Badge variant="outline" className="text-xs font-medium">
                                {getDiaLabel(dia.dia_semana)?.substring(0, 3)}
                              </Badge>
                            </div>
                            <div className="col-span-1 text-center">
                              <Badge variant="outline" className="bg-slate-50">{dia.totalClientes}</Badge>
                            </div>
                            <div className="col-span-1 text-center">
                              <Badge className="bg-green-100 text-green-700">{dia.atendidos}</Badge>
                            </div>
                            <div className="col-span-1 text-center">
                              <Badge className="bg-red-100 text-red-700">{dia.naoAtendidos}</Badge>
                            </div>
                            <div className="col-span-1 text-center">
                              <Badge className="bg-yellow-100 text-yellow-700">{dia.pendentes}</Badge>
                            </div>
                            <div className="col-span-1 text-center">
                              <span className="text-xs font-semibold text-green-600">
                                {dia.taxaAtendimento}%
                              </span>
                            </div>
                            <div className="col-span-1 text-center">
                              <span className="text-xs font-semibold text-red-600">{dia.taxaNaoAtendimento}%</span>
                            </div>
                            <div className="col-span-1 text-center">
                              <span className="text-xs font-semibold text-yellow-600">{dia.taxaPendencia}%</span>
                            </div>
                            <div className="col-span-3 flex items-center justify-center gap-2">
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onVerRoteiro(dia.roteiro); }}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost">
                                {expandedDias[dia.key] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </Button>
                            </div>
                          </div>
                          
                          {/* Mobile */}
                          <div className="md:hidden space-y-2">
                            <div className="flex items-center justify-between">
                              <Badge variant="outline" className="text-xs font-medium">
                                {getDiaLabel(dia.dia_semana)}
                              </Badge>
                              <div className="flex items-center gap-1">
                                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onVerRoteiro(dia.roteiro); }}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="ghost">
                                  {expandedDias[dia.key] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </Button>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <Badge variant="outline">{dia.totalClientes} cli.</Badge>
                              <Badge className="bg-green-100 text-green-700">{dia.atendidos} at.</Badge>
                              <Badge className="bg-red-100 text-red-700">{dia.naoAtendidos} não at.</Badge>
                              <Badge className="bg-yellow-100 text-yellow-700">{dia.pendentes} pend.</Badge>
                            </div>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent>
                        <div className="border-t bg-slate-50 p-4 space-y-4">
                          {/* Resumo do dia */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-white p-3 rounded-lg border">
                              <div className="text-xs text-slate-500">Com Pedido</div>
                              <div className="text-lg font-bold text-green-600 flex items-center gap-1">
                                <ShoppingCart className="w-4 h-4" />{dia.comPedido}
                              </div>
                            </div>
                            <div className="bg-white p-3 rounded-lg border">
                              <div className="text-xs text-slate-500">Sem Pedido</div>
                              <div className="text-lg font-bold text-red-600 flex items-center gap-1">
                                <XCircle className="w-4 h-4" />{dia.semPedido}
                              </div>
                            </div>
                            <div className="bg-white p-3 rounded-lg border">
                              <div className="text-xs text-slate-500">Taxa Pedidos</div>
                              <div className="text-lg font-bold text-blue-600 flex items-center gap-1">
                                <Percent className="w-4 h-4" />
                                {dia.atendidos > 0 ? ((dia.comPedido / dia.atendidos) * 100).toFixed(1) : 0}%
                              </div>
                            </div>
                            <div className="bg-white p-3 rounded-lg border">
                              <div className="text-xs text-slate-500">Total Clientes</div>
                              <div className="text-lg font-bold text-slate-700">{dia.totalClientes}</div>
                            </div>
                          </div>

                          {/* Tabs com clientes */}
                          <Tabs defaultValue="atendidos" className="w-full">
                            <TabsList className="grid w-full grid-cols-3">
                              <TabsTrigger value="atendidos" className="text-xs">
                                Atendidos ({dia.detalhesClientes.atendidos.length})
                              </TabsTrigger>
                              <TabsTrigger value="naoAtendidos" className="text-xs">
                                Não Atendidos ({dia.detalhesClientes.naoAtendidos.length})
                              </TabsTrigger>
                              <TabsTrigger value="pendentes" className="text-xs">
                                Pendentes ({dia.detalhesClientes.pendentes.length})
                              </TabsTrigger>
                            </TabsList>
                            <TabsContent value="atendidos" className="mt-3">
                              <ClientesList clientes={dia.detalhesClientes.atendidos} tipo="atendido" />
                            </TabsContent>
                            <TabsContent value="naoAtendidos" className="mt-3">
                              <ClientesList clientes={dia.detalhesClientes.naoAtendidos} tipo="naoAtendido" />
                            </TabsContent>
                            <TabsContent value="pendentes" className="mt-3">
                              <ClientesList clientes={dia.detalhesClientes.pendentes} tipo="pendente" />
                            </TabsContent>
                          </Tabs>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ))}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ))}
    </div>
  );
}

function ClientesList({ clientes, tipo }) {
  if (clientes.length === 0) {
    return (
      <div className="text-center py-4 text-slate-400 text-sm">
        Nenhum cliente {tipo === 'atendido' ? 'atendido' : tipo === 'naoAtendido' ? 'não atendido' : 'pendente'}
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {clientes.map((item, idx) => (
        <div 
          key={idx} 
          className={`p-3 rounded-lg border ${
            tipo === 'atendido' ? 'bg-green-50 border-green-200' :
            tipo === 'naoAtendido' ? 'bg-red-50 border-red-200' :
            'bg-yellow-50 border-yellow-200'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-slate-800 truncate">
                {item.cliente?.nome_fantasia || item.cliente?.razao_social || 'Cliente não encontrado'}
              </p>
              <p className="text-xs text-slate-500">
                {item.cliente?.codigo} • {item.cliente?.cidade || 'Sem cidade'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {tipo === 'atendido' && (
                <>
                  {item.pedido_solicitado === true ? (
                    <Badge className="bg-green-600 text-white text-xs">
                      <ShoppingCart className="w-3 h-3 mr-1" />
                      Com Pedido
                    </Badge>
                  ) : (
                    <Badge className="bg-slate-500 text-white text-xs">
                      <XCircle className="w-3 h-3 mr-1" />
                      Sem Pedido
                    </Badge>
                  )}
                  {item.checkin_time && (
                    <span className="text-xs text-slate-500">
                      {new Date(item.checkin_time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </>
              )}
              {tipo === 'naoAtendido' && (
                <>
                  <Badge className="bg-red-600 text-white text-xs">
                    <XCircle className="w-3 h-3 mr-1" />
                    Não Atendido
                  </Badge>
                  {item.motivo_nao_atendimento && (
                    <span className="text-xs text-red-600 text-right max-w-[150px] truncate">
                      {item.motivo_nao_atendimento}
                    </span>
                  )}
                </>
              )}
              {tipo === 'pendente' && (
                <Badge className="bg-yellow-600 text-white text-xs">
                  <Clock className="w-3 h-3 mr-1" />
                  Pendente
                </Badge>
              )}
            </div>
          </div>
        </div>
      ))}
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
                    {(() => {
                      const cByCod = visita.cliente_codigo ? clientesMapByCodigo[visita.cliente_codigo] : undefined;
                      const cById = clientesMap[visita.cliente_id];
                      const c = cByCod || cById;
                      return c?.nome_fantasia || c?.razao_social || visita.cliente_nome || 'N/A';
                    })()}
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