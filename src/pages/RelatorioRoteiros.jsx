import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Route, Users, MapPin, Filter, Calendar, Download,
  CheckCircle, XCircle, Clock, AlertTriangle, Eye
} from 'lucide-react';

export default function RelatorioRoteiros() {
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [filtroVendedor, setFiltroVendedor] = useState('todos');
  const [filtroRegiao, setFiltroRegiao] = useState('todos');
  const [mostrarApenasPendentes, setMostrarApenasPendentes] = useState(false);

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitas'],
    queryFn: () => base44.entities.Visita.list('-data_visita', 5000)
  });

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

  // Mapas
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);
  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);

  // Regiões únicas (cidades)
  const regioesUnicas = useMemo(() => {
    const cidades = new Set(clientes.map(c => c.cidade).filter(Boolean));
    return Array.from(cidades).sort();
  }, [clientes]);

  // Dias no período
  const diasNoPeriodo = useMemo(() => {
    const days = [];
    const startDate = new Date(dataInicio);
    const endDate = new Date(dataFim);
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d).toISOString().split('T')[0]);
    }
    return days;
  }, [dataInicio, dataFim]);

  const diasSemanaMap = {
    0: 'domingo', 1: 'segunda-feira', 2: 'terca-feira', 3: 'quarta-feira',
    4: 'quinta-feira', 5: 'sexta-feira', 6: 'sabado'
  };

  // Relatório de roteiros por dia
  const relatorioPorDia = useMemo(() => {
    const resultado = [];

    diasNoPeriodo.forEach(dia => {
      const diaSemana = diasSemanaMap[new Date(dia + 'T12:00:00').getDay()];
      const roteirosDoDia = roteiros.filter(r => {
        if (r.dia_semana !== diaSemana) return false;
        if (filtroVendedor !== 'todos' && r.vendedor_id !== filtroVendedor) return false;
        return true;
      });

      const visitasDoDia = visitas.filter(v => v.data_visita === dia);
      const clientesVisitados = new Set(visitasDoDia.map(v => v.cliente_id));

      roteirosDoDia.forEach(roteiro => {
        const vendedor = vendedoresMap[roteiro.vendedor_id];
        const clientesRoteiro = (roteiro.clientes_ids || []).map(id => clientesMap[id]).filter(Boolean);

        // Filtrar por região se selecionado
        const clientesFiltrados = filtroRegiao === 'todos' 
          ? clientesRoteiro 
          : clientesRoteiro.filter(c => c.cidade === filtroRegiao);

        const clientesAtendidos = clientesFiltrados.filter(c => clientesVisitados.has(c.id));
        const clientesPendentes = clientesFiltrados.filter(c => !clientesVisitados.has(c.id));

        const temPendente = clientesPendentes.length > 0;

        if (mostrarApenasPendentes && !temPendente) return;

        resultado.push({
          data: dia,
          diaSemana,
          vendedor: vendedor?.nome || 'N/A',
          vendedorId: roteiro.vendedor_id,
          totalClientes: clientesFiltrados.length,
          atendidos: clientesAtendidos.length,
          pendentes: clientesPendentes.length,
          clientesAtendidos: clientesAtendidos.map(c => ({
            ...c,
            visita: visitasDoDia.find(v => v.cliente_id === c.id)
          })),
          clientesPendentes
        });
      });
    });

    return resultado.sort((a, b) => b.data.localeCompare(a.data));
  }, [diasNoPeriodo, roteiros, visitas, vendedoresMap, clientesMap, filtroVendedor, filtroRegiao, mostrarApenasPendentes]);

  // Estatísticas
  const stats = useMemo(() => {
    const totalClientes = relatorioPorDia.reduce((sum, r) => sum + r.totalClientes, 0);
    const totalAtendidos = relatorioPorDia.reduce((sum, r) => sum + r.atendidos, 0);
    const totalPendentes = relatorioPorDia.reduce((sum, r) => sum + r.pendentes, 0);

    return {
      totalRoteiros: relatorioPorDia.length,
      totalClientes,
      totalAtendidos,
      totalPendentes,
      taxaAtendimento: totalClientes > 0 ? ((totalAtendidos / totalClientes) * 100).toFixed(1) : 0
    };
  }, [relatorioPorDia]);

  const exportarCSV = () => {
    const linhas = ['Data;Dia;Vendedor;Total Clientes;Atendidos;Pendentes'];
    relatorioPorDia.forEach(r => {
      linhas.push(`${new Date(r.data).toLocaleDateString('pt-BR')};${r.diaSemana};${r.vendedor};${r.totalClientes};${r.atendidos};${r.pendentes}`);
    });
    const csv = linhas.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_roteiros_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    link.click();
  };

  const getDiaSemanaLabel = (dia) => {
    const labels = {
      'domingo': 'Domingo', 'segunda-feira': 'Segunda', 'terca-feira': 'Terça',
      'quarta-feira': 'Quarta', 'quinta-feira': 'Quinta', 'sexta-feira': 'Sexta', 'sabado': 'Sábado'
    };
    return labels[dia] || dia;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl">
            <Route className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Relatório de Roteiros/Visitas</h1>
            <p className="text-slate-500 mt-1">Visualização de execução de rotas e pendências</p>
          </div>
        </div>
        <Button onClick={exportarCSV} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          Exportar CSV
        </Button>
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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                  {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Região (Cidade)</label>
              <Select value={filtroRegiao} onValueChange={setFiltroRegiao}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  {regioesUnicas.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={mostrarApenasPendentes} onCheckedChange={setMostrarApenasPendentes} />
                <span className="text-sm font-medium text-slate-700">Apenas com pendências</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-700">{stats.totalRoteiros}</div>
            <div className="text-sm text-blue-600">Roteiros</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-pink-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-700">{stats.totalClientes}</div>
            <div className="text-sm text-purple-600">Clientes Programados</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-700">{stats.totalAtendidos}</div>
            <div className="text-sm text-green-600">Atendidos</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-red-50 to-orange-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-700">{stats.totalPendentes}</div>
            <div className="text-sm text-red-600">Pendentes</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-amber-50 to-yellow-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-700">{stats.taxaAtendimento}%</div>
            <div className="text-sm text-amber-600">Taxa Atendimento</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de Roteiros */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle>Roteiros Executados ({relatorioPorDia.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {relatorioPorDia.length === 0 ? (
            <div className="text-center py-12">
              <Route className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Nenhum roteiro encontrado no período</p>
            </div>
          ) : (
            <div className="space-y-4">
              {relatorioPorDia.map((item, idx) => (
                <Card key={idx} className={`border-2 ${item.pendentes > 0 ? 'border-red-200 bg-red-50/30' : 'border-green-200 bg-green-50/30'}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Calendar className="w-5 h-5 text-slate-500" />
                        <div>
                          <span className="font-bold text-slate-800">
                            {new Date(item.data).toLocaleDateString('pt-BR')}
                          </span>
                          <span className="text-slate-500 ml-2">({getDiaSemanaLabel(item.diaSemana)})</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className="bg-slate-100 text-slate-700">
                          <Users className="w-3 h-3 mr-1" />
                          {item.vendedor}
                        </Badge>
                        <Badge className={item.pendentes > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                          {item.atendidos}/{item.totalClientes} atendidos
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Clientes Atendidos */}
                      <div>
                        <h4 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1">
                          <CheckCircle className="w-4 h-4" /> Atendidos ({item.clientesAtendidos.length})
                        </h4>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {item.clientesAtendidos.map((c, cIdx) => (
                            <div key={cIdx} className="text-sm p-2 bg-green-50 rounded flex items-center justify-between">
                              <div>
                                <span className="font-medium">{c.nome_fantasia || c.razao_social}</span>
                                <span className="text-slate-500 ml-2 text-xs">{c.cidade}</span>
                              </div>
                              {c.visita?.pedido_solicitado === true && (
                                <Badge className="bg-green-500 text-white text-xs">Pedido</Badge>
                              )}
                            </div>
                          ))}
                          {item.clientesAtendidos.length === 0 && (
                            <p className="text-xs text-slate-400">Nenhum cliente atendido</p>
                          )}
                        </div>
                      </div>

                      {/* Clientes Pendentes */}
                      <div>
                        <h4 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1">
                          <XCircle className="w-4 h-4" /> Pendentes ({item.clientesPendentes.length})
                        </h4>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {item.clientesPendentes.map((c, cIdx) => (
                            <div key={cIdx} className="text-sm p-2 bg-red-50 rounded">
                              <span className="font-medium">{c.nome_fantasia || c.razao_social}</span>
                              <span className="text-slate-500 ml-2 text-xs">{c.cidade}</span>
                            </div>
                          ))}
                          {item.clientesPendentes.length === 0 && (
                            <p className="text-xs text-slate-400">Todos os clientes foram atendidos! ✓</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}