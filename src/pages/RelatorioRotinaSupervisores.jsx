import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Clock, Calendar, Search, X, FileText } from 'lucide-react';
import VisitaCardResumida from '@/components/RotaSupervisor/VisitaCardResumida';

export default function RelatorioRotinaSupervisores() {
  const [filtroSupervisor, setFiltroSupervisor] = useState('');
  const [filtroDataDe, setFiltroDataDe] = useState('');
  const [filtroDataAte, setFiltroDataAte] = useState('');
  const [buscaGeral, setBuscaGeral] = useState('');
  const [filtroFuncionario, setFiltroFuncionario] = useState('');

  const { data: rotas = [], isLoading } = useQuery({
    queryKey: ['rotasSupervisorRelatorio'],
    queryFn: () => base44.entities.RotaSupervisor.list('-data', 500)
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitasSupervisorRelatorio'],
    queryFn: () => base44.entities.VisitaSupervisor.list('-data_visita', 2000)
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientesRelatorio'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 5000)
  });

  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteirosRelatorio'],
    queryFn: () => base44.entities.Roteiro.list('-created_date', 2000)
  });

  // Supervisores que têm rotas
  const supervisores = useMemo(() => {
    const ids = [...new Set(rotas.map(r => r.supervisor_id))];
    return ids.map(id => {
      const v = vendedores.find(ve => ve.id === id);
      return v ? { id: v.id, nome: v.nome } : { id, nome: rotas.find(r => r.supervisor_id === id)?.supervisor_nome || id };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [rotas, vendedores]);

  // Clientes vinculados a um funcionário (via roteiro ou carteira)
  const clienteIdsFuncionario = useMemo(() => {
    if (!filtroFuncionario) return null;
    const ids = new Set();
    // Clientes nos roteiros do funcionário
    roteiros.filter(r => r.vendedor_id === filtroFuncionario).forEach(r => {
      (r.clientes_ids || []).forEach(cid => ids.add(cid));
    });
    // Clientes da carteira (vendedor_id no cliente)
    clientes.filter(c => c.vendedor_id === filtroFuncionario).forEach(c => ids.add(c.id));
    return ids;
  }, [filtroFuncionario, roteiros, clientes]);

  const rotasFiltradas = useMemo(() => {
    return rotas.filter(r => {
      // Filtro supervisor
      if (filtroSupervisor && r.supervisor_id !== filtroSupervisor) return false;
      // Filtro período De
      if (filtroDataDe && r.data < filtroDataDe) return false;
      // Filtro período Até
      if (filtroDataAte && r.data > filtroDataAte) return false;

      const visitasRota = visitas.filter(v => v.rota_supervisor_id === r.id);

      // Filtro funcionário: a rota precisa ter pelo menos 1 visita a um cliente do funcionário
      if (clienteIdsFuncionario) {
        const temClienteFuncionario = visitasRota.some(v => clienteIdsFuncionario.has(v.cliente_id));
        if (!temClienteFuncionario) return false;
      }

      // Busca geral
      if (buscaGeral) {
        const t = buscaGeral.toLowerCase();
        const matchRota = r.supervisor_nome?.toLowerCase().includes(t) ||
          r.data?.includes(t) ||
          r.resumo_geral?.toLowerCase().includes(t);
        const matchVisita = visitasRota.some(v =>
          v.cliente_nome?.toLowerCase().includes(t) ||
          v.cliente_codigo?.toLowerCase().includes(t) ||
          v.cliente_cidade?.toLowerCase().includes(t) ||
          (v.tipos_visita || []).some(tip => tip.toLowerCase().includes(t))
        );
        if (!matchRota && !matchVisita) return false;
      }

      return true;
    });
  }, [rotas, visitas, filtroSupervisor, filtroDataDe, filtroDataAte, buscaGeral, clienteIdsFuncionario]);

  const limparFiltros = () => {
    setFiltroSupervisor('');
    setFiltroDataDe('');
    setFiltroDataAte('');
    setBuscaGeral('');
    setFiltroFuncionario('');
  };

  const temFiltro = filtroSupervisor || filtroDataDe || filtroDataAte || buscaGeral || filtroFuncionario;

  const tempoTotal = (r) => {
    if (!r.tempo_total_minutos) return '-';
    const h = Math.floor(r.tempo_total_minutos / 60);
    const m = r.tempo_total_minutos % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Rotina Supervisores" icon={FileText} subtitle="Relatório de visitas realizadas pelos supervisores" />

      {/* Filtros */}
      <Card className="border-0 shadow-lg">
        <CardContent className="pt-5 pb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Supervisor */}
            <div>
              <Label className="text-xs font-medium">Supervisor</Label>
              <Select value={filtroSupervisor} onValueChange={(v) => setFiltroSupervisor(v === '__all__' ? '' : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  {supervisores.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Período De */}
            <div>
              <Label className="text-xs font-medium">Período De</Label>
              <Input type="date" value={filtroDataDe} onChange={(e) => setFiltroDataDe(e.target.value)} className="h-9" />
            </div>

            {/* Período Até */}
            <div>
              <Label className="text-xs font-medium">Período Até</Label>
              <Input type="date" value={filtroDataAte} onChange={(e) => setFiltroDataAte(e.target.value)} className="h-9" />
            </div>

            {/* Funcionário */}
            <div>
              <Label className="text-xs font-medium">Funcionário (carteira/roteiro)</Label>
              <Select value={filtroFuncionario} onValueChange={(v) => setFiltroFuncionario(v === '__all__' ? '' : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  {vendedores.filter(v => v.status === 'ativo').sort((a, b) => a.nome.localeCompare(b.nome)).map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 w-full">
              <Label className="text-xs font-medium">Busca Geral</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Buscar por cliente, cidade, tipo de visita..."
                  value={buscaGeral}
                  onChange={(e) => setBuscaGeral(e.target.value)}
                  className="h-9 pl-8"
                />
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 whitespace-nowrap"
              onClick={limparFiltros}
              disabled={!temFiltro}
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Contador */}
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <Badge variant="outline" className="font-normal">
          {rotasFiltradas.length} roteiro(s) encontrado(s)
        </Badge>
        {temFiltro && (
          <span className="text-xs text-amber-600">Filtros ativos</span>
        )}
      </div>

      {/* Resultados */}
      {isLoading ? (
        <p className="text-sm text-center text-slate-500 py-8">Carregando...</p>
      ) : rotasFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500">Nenhum roteiro encontrado com os filtros aplicados.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rotasFiltradas.map(rota => {
            let visitasRota = visitas.filter(v => v.rota_supervisor_id === rota.id);
            // Se tem filtro de funcionário, mostrar apenas visitas aos clientes daquele funcionário
            if (clienteIdsFuncionario) {
              visitasRota = visitasRota.filter(v => clienteIdsFuncionario.has(v.cliente_id));
            }
            return (
              <Collapsible key={rota.id}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-slate-50 transition-colors py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-amber-600" />
                            {new Date(rota.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </CardTitle>
                          <p className="text-xs text-slate-500 mt-1">{rota.supervisor_nome}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <Badge variant="outline" className="text-xs">
                            {visitasRota.length} visita(s)
                          </Badge>
                          <Badge className={rota.status === 'finalizado' ? 'bg-green-500' : 'bg-blue-500'}>
                            {rota.status === 'finalizado' ? 'Finalizado' : 'Em Andamento'}
                          </Badge>
                          {rota.tempo_total_minutos > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <Clock className="w-3 h-3 mr-1" />{tempoTotal(rota)}
                            </Badge>
                          )}
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0 space-y-2">
                      {rota.resumo_geral && (
                        <div className="p-2 bg-amber-50 rounded text-sm border border-amber-100">
                          <strong className="text-xs text-amber-700">Resumo:</strong>
                          <p className="text-xs text-slate-700">{rota.resumo_geral}</p>
                        </div>
                      )}
                      {visitasRota.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-2">Nenhuma visita registrada</p>
                      ) : (
                        visitasRota.map(v => <VisitaCardResumida key={v.id} visita={v} />)
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}