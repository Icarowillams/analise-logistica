import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Send, Search } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CORES = { pendente: 'bg-yellow-100 text-yellow-800', agendado: 'bg-blue-100 text-blue-800', efetivado: 'bg-green-100 text-green-800', cancelado: 'bg-red-100 text-red-800' };
const FORM_INICIAL = { numero_nf: '', cliente_nome: '', valor: '', data_reenvio: '', observacoes: '' };

export default function ControleTransferencias() {
  const [busca, setBusca] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const qc = useQueryClient();

  const { data: transferencias = [] } = useQuery({
    queryKey: ['transferencias'],
    queryFn: () => base44.entities.Transferencia.list('-data_reenvio', 200)
  });

  const criar = useMutation({
    mutationFn: (data) => base44.entities.Transferencia.create({ ...data, numero_transferencia: `TRF-${Date.now()}`, status: 'pendente' }),
    onSuccess: () => { qc.invalidateQueries(['transferencias']); setModalAberto(false); setForm(FORM_INICIAL); toast.success('Transferência registrada!'); }
  });

  const atualizarStatus = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Transferencia.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries(['transferencias']); toast.success('Status atualizado!'); }
  });

  const filtradas = transferencias.filter(t =>
    !busca || t.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) || t.numero_nf?.includes(busca)
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Transferências" icon={Send} subtitle="Reenvio de notas fiscais" action={() => setModalAberto(true)} actionLabel="Nova Transferência" />

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input placeholder="Buscar por cliente ou NF..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-8 h-9" />
      </div>

      <div className="space-y-2">
        {filtradas.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-slate-500 text-sm">Nenhuma transferência encontrada.</CardContent></Card>
        ) : filtradas.map(t => (
          <Card key={t.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-sm">{t.cliente_nome || '—'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">NF: {t.numero_nf || '—'}</div>
                  {t.data_reenvio && <div className="text-xs text-slate-400">Reenvio: {new Date(t.data_reenvio + 'T12:00:00').toLocaleDateString('pt-BR')}</div>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge className={STATUS_CORES[t.status] || 'bg-slate-100'}>{t.status}</Badge>
                  {t.valor > 0 && <span className="text-xs font-semibold text-amber-600">R$ {Number(t.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                  <Select value={t.status} onValueChange={v => atualizarStatus.mutate({ id: t.id, status: v })}>
                    <SelectTrigger className="h-6 text-xs w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendente">Pendente</SelectItem>
                      <SelectItem value="agendado">Agendado</SelectItem>
                      <SelectItem value="efetivado">Efetivado</SelectItem>
                      <SelectItem value="cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Transferência</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Nº NF</Label><Input value={form.numero_nf} onChange={e => setForm(p => ({ ...p, numero_nf: e.target.value }))} /></div>
              <div><Label className="text-xs">Valor</Label><Input type="number" value={form.valor} onChange={e => setForm(p => ({ ...p, valor: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Cliente</Label><Input value={form.cliente_nome} onChange={e => setForm(p => ({ ...p, cliente_nome: e.target.value }))} /></div>
            <div><Label className="text-xs">Data de Reenvio</Label><Input type="date" value={form.data_reenvio} onChange={e => setForm(p => ({ ...p, data_reenvio: e.target.value }))} /></div>
            <div><Label className="text-xs">Observações</Label><Textarea value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={2} /></div>
            <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white" onClick={() => criar.mutate(form)} disabled={criar.isPending}>Registrar Transferência</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}