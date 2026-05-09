import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import DiaRoteiroCard from './DiaRoteiroCard';
import ClienteVisitaDialog from './ClienteVisitaDialog';
import { DIAS_SEMANA, normalizarDia } from './roteirosUtils';

export default function RotaSupervisores({ vendedores, supervisor, roteiros, visitas, pedidos, onRefresh }) {
  const equipe = useMemo(() => vendedores.filter(v => !supervisor?.id || v.supervisor_id === supervisor.id || v.supervisor_ids?.includes(supervisor.id)), [vendedores, supervisor]);
  const [vendedorId, setVendedorId] = useState(equipe[0]?.id || '');
  const [selecionado, setSelecionado] = useState(null);
  const [roteiroEdit, setRoteiroEdit] = useState(null);

  const vendedorSelecionado = vendedores.find(v => v.id === vendedorId);
  const roteirosDoVendedor = roteiros.filter(r => r.vendedor_id === vendedorId);

  const salvarAjuste = async () => {
    if (!roteiroEdit?.id) return;
    await base44.entities.Roteiro.update(roteiroEdit.id, {
      status: roteiroEdit.status,
      feedback_supervisor: roteiroEdit.feedback_supervisor || ''
    });
    toast.success('Ajustes do roteiro salvos.');
    setRoteiroEdit(null);
    onRefresh?.();
  };

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 grid md:grid-cols-3 gap-4 items-end">
        <div>
          <Label>Vendedor da equipe</Label>
          <Select value={vendedorId} onValueChange={setVendedorId}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{equipe.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {roteiroEdit && <div><Label>Status do roteiro</Label><Select value={roteiroEdit.status} onValueChange={(v) => setRoteiroEdit({ ...roteiroEdit, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="planejado">Planejado</SelectItem><SelectItem value="ativo">Ativo</SelectItem><SelectItem value="pausado">Pausado</SelectItem><SelectItem value="concluido">Concluído</SelectItem></SelectContent></Select></div>}
        {roteiroEdit && <Button onClick={salvarAjuste}>Salvar ajuste</Button>}
      </CardContent></Card>

      {roteiroEdit && <div className="rounded-xl border bg-white p-4"><Label>Feedback/orientação ao vendedor</Label><Textarea value={roteiroEdit.feedback_supervisor || ''} onChange={(e) => setRoteiroEdit({ ...roteiroEdit, feedback_supervisor: e.target.value })} /></div>}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {DIAS_SEMANA.map(dia => {
          const roteiro = roteirosDoVendedor.find(r => normalizarDia(r.dia_semana) === dia.key);
          return <div key={dia.key} onDoubleClick={() => roteiro && setRoteiroEdit(roteiro)}><DiaRoteiroCard dia={dia} roteiro={roteiro} visitas={visitas} onClienteClick={(r, c, v) => setSelecionado({ roteiro: r, cliente: c, visita: v })} /></div>;
        })}
      </div>
      <p className="text-xs text-slate-500">Dica: dê duplo clique em um card de dia para editar status e feedback do roteiro.</p>

      <ClienteVisitaDialog open={!!selecionado} onOpenChange={() => setSelecionado(null)} roteiro={selecionado?.roteiro} cliente={selecionado?.cliente} visita={selecionado?.visita} pedidos={pedidos} onSaved={onRefresh} />
    </div>
  );
}