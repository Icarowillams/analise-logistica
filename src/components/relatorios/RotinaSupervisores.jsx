import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, ChevronDown, MapPin, Clock, X } from 'lucide-react';
import { dentroPeriodo, duracaoMin } from '@/components/analises/utilsAnalises';

const DIAS_PT = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];

export default function RotinaSupervisores() {
  const [filtros, setFiltros] = useState({ supervisor_id: '', inicio: '', fim: '', vendedor_id: '', busca: '' });
  const [expanded, setExpanded] = useState({});
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: roteiros = [] } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list('-updated_date', 5000) });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitas'], queryFn: () => base44.entities.VisitaRoteiro.list('-data_visita', 10000) });

  const supervisores = useMemo(() => vendedores.filter(v => v.papeis?.includes('supervisor') || vendedores.some(x => x.supervisor_id === v.id)), [vendedores]);

  const linhas = useMemo(() => {
    const dataMap = new Map();
    visitas.forEach(v => {
      if (filtros.vendedor_id && v.vendedor_id !== filtros.vendedor_id) return;
      if ((filtros.inicio || filtros.fim) && !dentroPeriodo(v.data_visita, filtros.inicio, filtros.fim)) return;
      const sup = vendedores.find(x => x.id === v.vendedor_id)?.supervisor_id;
      if (filtros.supervisor_id && sup !== filtros.supervisor_id) return;
      if (filtros.busca && !`${v.cliente_nome} ${v.cliente_cidade} ${v.tipo_visita}`.toLowerCase().includes(filtros.busca.toLowerCase())) return;
      const k = `${v.data_visita}|${v.vendedor_id}`;
      if (!dataMap.has(k)) dataMap.set(k, { data: v.data_visita, vendedor_nome: v.vendedor_nome, vendedor_id: v.vendedor_id, visitas: [] });
      dataMap.get(k).visitas.push(v);
    });
    return Array.from(dataMap.values()).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  }, [visitas, vendedores, filtros]);

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div><Label className="text-xs">Supervisor</Label><Select value={filtros.supervisor_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, supervisor_id: v === '_t_' ? '' : v })}><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="_t_">Todos</SelectItem>{supervisores.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Período De</Label><Input type="date" value={filtros.inicio} onChange={(e) => setFiltros({ ...filtros, inicio: e.target.value })} /></div>
        <div><Label className="text-xs">Período Até</Label><Input type="date" value={filtros.fim} onChange={(e) => setFiltros({ ...filtros, fim: e.target.value })} /></div>
        <div><Label className="text-xs">Funcionário (carteira/roteiro)</Label><Select value={filtros.vendedor_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, vendedor_id: v === '_t_' ? '' : v })}><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="_t_">Todos</SelectItem>{vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent></Select></div>
        <div className="md:col-span-3"><Label className="text-xs">Busca Geral</Label><Input value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} placeholder="Buscar por cliente, cidade, tipo de visita..." /></div>
        <div className="md:col-span-1 flex items-end"><Button variant="outline" onClick={() => setFiltros({ supervisor_id: '', inicio: '', fim: '', vendedor_id: '', busca: '' })} className="w-full"><X className="w-4 h-4" />Limpar Filtros</Button></div>
      </CardContent></Card>

      <p className="text-sm text-slate-600">{linhas.length} roteiro(s) encontrado(s)</p>

      <div className="space-y-2">{linhas.map((l, idx) => {
        const dia = l.data ? DIAS_PT[new Date(l.data).getDay()] : '';
        const concluidas = l.visitas.filter(v => v.status === 'concluida').length;
        return (
          <div key={idx} className="rounded-xl bg-white border shadow-sm overflow-hidden">
            <div className="flex justify-between items-center p-3 cursor-pointer hover:bg-slate-50" onClick={() => setExpanded({ ...expanded, [idx]: !expanded[idx] })}>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-500" />
                <div>
                  <p className="font-medium">{dia}, {l.data ? new Date(l.data).toLocaleDateString('pt-BR') : '-'}</p>
                  <p className="text-xs text-slate-500 uppercase">{l.vendedor_nome}</p>
                </div>
              </div>
              <div className="flex gap-2 items-center"><span className="text-xs px-2 py-1 rounded bg-slate-100">{concluidas} visita(s)</span><span className="text-xs px-2 py-1 rounded bg-blue-500 text-white">Em Andamento</span><ChevronDown className={`w-4 h-4 transition ${expanded[idx] ? 'rotate-180' : ''}`} /></div>
            </div>
            {expanded[idx] && (
              <div className="border-t bg-slate-50 px-4 py-2 space-y-2">{l.visitas.map(v => (
                <div key={v.id} className="bg-white border rounded p-3 flex justify-between">
                  <div>
                    <p className="text-sm font-bold">🏢 {v.cliente_codigo} - {v.cliente_nome}</p>
                    <p className="text-xs text-slate-500 uppercase mt-0.5"><MapPin className="w-3 h-3 inline" /> {v.cliente_cidade || '-'}</p>
                    <div className="flex gap-2 mt-1.5">{v.tipo_visita && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">{v.tipo_visita}</span>}{(v.estoque_itens || []).length > 0 && <span className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">estoque</span>}{(v.trocas_itens || []).length > 0 && <span className="text-[10px] px-2 py-0.5 rounded bg-rose-100 text-rose-700">troca</span>}</div>
                  </div>
                  <div className="text-right"><p className="text-xs text-emerald-600 font-medium">✓ {v.status === 'concluida' ? 'Concluída' : v.status}</p><p className="text-xs text-slate-500 flex items-center gap-1 justify-end mt-1"><Clock className="w-3 h-3" />{duracaoMin(v.checkin_em, v.checkout_em)} min</p></div>
                </div>
              ))}</div>
            )}
          </div>
        );
      })}</div>
    </div>
  );
}