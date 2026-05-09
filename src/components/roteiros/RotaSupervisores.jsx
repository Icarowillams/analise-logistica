import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { DIAS_SEMANA, diaParaKey, STATUS_VISITA } from './roteirosUtils';

export default function RotaSupervisores({ supervisor, vendedores }) {
  const [vendedorId, setVendedorId] = useState('');
  const equipe = useMemo(() => vendedores.filter(v => !supervisor?.id || v.supervisor_id === supervisor.id || v.supervisor_ids?.includes(supervisor.id)), [vendedores, supervisor]);
  const { data: roteiros = [] } = useQuery({ queryKey: ['roteirosSupervisor', vendedorId], queryFn: () => base44.entities.Roteiro.filter({ vendedor_id: vendedorId }, '-updated_date', 200), enabled: !!vendedorId });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitasSupervisor', vendedorId], queryFn: () => base44.entities.VisitaRoteiro.filter({ vendedor_id: vendedorId }, '-updated_date', 1000), enabled: !!vendedorId });

  const salvarFeedback = async (roteiro, feedback) => {
    await base44.entities.Roteiro.update(roteiro.id, { feedback_supervisor: feedback });
    toast.success('Feedback enviado ao vendedor.');
  };
  const alterarStatus = async (roteiro, status) => {
    await base44.entities.Roteiro.update(roteiro.id, { status });
    toast.success('Status atualizado.');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 grid md:grid-cols-3 gap-3 items-end">
          <div>
            <Label>Vendedor da equipe</Label>
            <Select value={vendedorId} onValueChange={setVendedorId}>
              <SelectTrigger><SelectValue placeholder="Selecione um vendedor" /></SelectTrigger>
              <SelectContent>{equipe.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 text-sm text-slate-500">Acompanhe os roteiros do vendedor selecionado em tempo real, ajuste status e deixe orientações.</div>
        </CardContent>
      </Card>

      {!vendedorId ? <Card><CardContent className="p-12 text-center text-slate-400">Selecione um vendedor para ver os roteiros</CardContent></Card> : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {DIAS_SEMANA.map(dia => {
            const r = roteiros.find(x => diaParaKey(x.dia_semana) === dia.key);
            const visitasDia = visitas.filter(v => v.roteiro_id === r?.id);
            const realizadas = visitasDia.filter(v => v.status === 'concluida').length;
            const total = r?.clientes_detalhes?.length || r?.clientes_ids?.length || 0;
            return (
              <Card key={dia.key}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">{dia.curto} • {total} clientes</CardTitle>
                    {r && <Badge variant="outline">{r.status}</Badge>}
                  </div>
                  {r && <p className="text-xs text-slate-500">{realizadas}/{total} realizadas</p>}
                </CardHeader>
                <CardContent className="space-y-2">
                  {!r ? <p className="text-sm text-slate-400">Sem roteiro</p> : (
                    <>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {(r.clientes_detalhes || []).slice(0, 6).map((c, i) => {
                          const v = visitasDia.find(x => x.cliente_id === c.cliente_id);
                          const cfg = STATUS_VISITA[v?.status || 'pendente'];
                          return <div key={i} className="flex justify-between items-center text-xs border-b py-1"><span>{i+1}. {c.cliente_nome}</span><Badge className={cfg.cor + ' text-[10px]'}>{cfg.label}</Badge></div>;
                        })}
                      </div>
                      <Select value={r.status} onValueChange={(v) => alterarStatus(r, v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="planejado">Planejado</SelectItem>
                          <SelectItem value="ativo">Ativo</SelectItem>
                          <SelectItem value="pausado">Pausado</SelectItem>
                          <SelectItem value="concluido">Concluído</SelectItem>
                        </SelectContent>
                      </Select>
                      <Textarea placeholder="Feedback ao vendedor..." defaultValue={r.feedback_supervisor || ''} onBlur={(e) => e.target.value !== r.feedback_supervisor && salvarFeedback(r, e.target.value)} className="text-xs" rows={2} />
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}