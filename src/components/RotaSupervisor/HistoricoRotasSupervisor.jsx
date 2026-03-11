import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Clock, MapPin, Calendar, Search } from 'lucide-react';
import VisitaCardResumida from './VisitaCardResumida';

export default function HistoricoRotasSupervisor() {
  const [filtroData, setFiltroData] = useState('');
  const [filtroSupervisor, setFiltroSupervisor] = useState('');

  const { data: rotas = [], isLoading } = useQuery({
    queryKey: ['rotasSupervisorHistorico'],
    queryFn: () => base44.entities.RotaSupervisor.list('-data', 100)
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitasSupervisorHistorico'],
    queryFn: () => base44.entities.VisitaSupervisor.list('-data_visita', 500)
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const supervisores = [...new Set(rotas.map(r => r.supervisor_id))].map(id => {
    const v = vendedores.find(ve => ve.id === id);
    return v ? { id: v.id, nome: v.nome } : { id, nome: rotas.find(r => r.supervisor_id === id)?.supervisor_nome || id };
  });

  const rotasFiltradas = rotas.filter(r => {
    if (filtroData && r.data !== filtroData) return false;
    if (filtroSupervisor && r.supervisor_id !== filtroSupervisor) return false;
    return true;
  });

  const tempoTotal = (r) => {
    if (!r.tempo_total_minutos) return '-';
    const h = Math.floor(r.tempo_total_minutos / 60);
    const m = r.tempo_total_minutos % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Filtrar por Data</Label>
          <Input type="date" value={filtroData} onChange={(e) => setFiltroData(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-xs">Filtrar por Supervisor</Label>
          <Select value={filtroSupervisor} onValueChange={setFiltroSupervisor}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Todos</SelectItem>
              {supervisores.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button variant="outline" size="sm" className="h-9 w-full" onClick={() => { setFiltroData(''); setFiltroSupervisor(''); }}>
            Limpar Filtros
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-center text-slate-500 py-8">Carregando...</p>
      ) : rotasFiltradas.length === 0 ? (
        <p className="text-sm text-center text-slate-500 py-8">Nenhum roteiro encontrado</p>
      ) : (
        <div className="space-y-3">
          {rotasFiltradas.map(rota => {
            const visitasRota = visitas.filter(v => v.rota_supervisor_id === rota.id);
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
                        <div className="flex items-center gap-2">
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