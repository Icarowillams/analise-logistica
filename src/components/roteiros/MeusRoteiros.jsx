import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Search, Send, CheckCircle2, XCircle } from 'lucide-react';
import CheckinDialog from './CheckinDialog';
import { DIAS_SEMANA, diaParaKey, diaAtualKey, STATUS_VISITA } from './roteirosUtils';

export default function MeusRoteiros({ vendedor }) {
  const queryClient = useQueryClient();
  const [diaSelecionado, setDiaSelecionado] = useState(diaAtualKey());
  const [busca, setBusca] = useState('');
  const [clienteAtivo, setClienteAtivo] = useState(null);

  const { data: roteiros = [] } = useQuery({ queryKey: ['roteirosVendedor', vendedor?.id], queryFn: () => base44.entities.Roteiro.filter({ vendedor_id: vendedor?.id }, '-updated_date', 200), enabled: !!vendedor?.id });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitasVendedor', vendedor?.id], queryFn: () => base44.entities.VisitaRoteiro.filter({ vendedor_id: vendedor?.id }, '-updated_date', 1000), enabled: !!vendedor?.id });

  useEffect(() => {
    if (!vendedor?.id) return;
    const unsub = base44.entities.VisitaRoteiro.subscribe(() => queryClient.invalidateQueries({ queryKey: ['visitasVendedor'] }));
    return unsub;
  }, [vendedor?.id, queryClient]);

  const contagensPorDia = useMemo(() => {
    const c = {};
    DIAS_SEMANA.forEach(d => { c[d.key] = 0; });
    roteiros.forEach(r => {
      const k = diaParaKey(r.dia_semana);
      const qtd = (r.clientes_detalhes?.length || r.clientes_ids?.length || 0);
      c[k] = (c[k] || 0) + qtd;
    });
    return c;
  }, [roteiros]);

  const roteiroDoDia = useMemo(() => roteiros.find(r => diaParaKey(r.dia_semana) === diaSelecionado), [roteiros, diaSelecionado]);
  const clientes = useMemo(() => {
    const lista = [...(roteiroDoDia?.clientes_detalhes || [])].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    if (!busca.trim()) return lista;
    const t = busca.toLowerCase();
    return lista.filter(c => (c.cliente_nome || '').toLowerCase().includes(t) || (c.cliente_codigo || '').toLowerCase().includes(t));
  }, [roteiroDoDia, busca]);

  const visitaDoCliente = (clienteId) => visitas.find(v => v.cliente_id === clienteId && v.roteiro_id === roteiroDoDia?.id);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[700px]">
          {DIAS_SEMANA.map(d => {
            const ativo = diaSelecionado === d.key;
            const qtd = contagensPorDia[d.key] || 0;
            return (
              <button key={d.key} onClick={() => setDiaSelecionado(d.key)} className={`py-3 text-center text-sm font-medium border-r last:border-r-0 transition ${ativo ? 'bg-white border-b-2 border-amber-500 text-slate-900' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                <div className="flex items-center justify-center gap-2">
                  <span>{d.curto}</span>
                  <span className={`inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold rounded-full ${qtd > 0 ? 'bg-amber-400 text-neutral-900' : 'bg-slate-200 text-slate-500'}`}>{qtd}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9 bg-white" placeholder="Buscar por razão social, nome fantasia ou código..." value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="space-y-3">
        {clientes.length === 0 && <div className="bg-white rounded-xl border p-8 text-center text-slate-400">Sem clientes para este dia.</div>}
        {clientes.map((c, i) => {
          const visita = visitaDoCliente(c.cliente_id);
          const status = visita?.status || 'pendente';
          const cfg = STATUS_VISITA[status];
          return (
            <div key={c.cliente_id} className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-start gap-3">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-amber-400 text-neutral-900 text-sm font-bold shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">{c.cliente_codigo} - {c.cliente_nome}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mt-0.5">{c.cliente_cidade || '-'}{c.cliente_endereco ? `, ${c.cliente_endereco}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600"><Send className="w-4 h-4" /></Button>
                  <Badge className={cfg.cor + ' border'}>{cfg.label}</Badge>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr,200px] gap-2 mt-3">
                <Button onClick={() => setClienteAtivo({ cliente: c, visita })} className="bg-blue-600 hover:bg-blue-700 text-white h-11">
                  <MapPin className="w-4 h-4" />{visita?.checkin_em ? 'Continuar visita' : 'Check-in'}
                </Button>
                <Button variant="outline" onClick={() => setClienteAtivo({ cliente: c, visita, modo: 'nao' })} className="border-red-300 text-red-600 hover:bg-red-50 h-11">
                  <XCircle className="w-4 h-4" />Não Atendimento
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <CheckinDialog open={!!clienteAtivo} onOpenChange={() => setClienteAtivo(null)} cliente={clienteAtivo?.cliente} roteiro={roteiroDoDia} vendedor={vendedor} visitaExistente={clienteAtivo?.visita} onSaved={() => queryClient.invalidateQueries({ queryKey: ['visitasVendedor'] })} />
    </div>
  );
}