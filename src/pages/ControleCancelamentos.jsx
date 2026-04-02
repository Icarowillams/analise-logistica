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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { XCircle, Search } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CORES = { solicitado: 'bg-yellow-100 text-yellow-800', aprovado: 'bg-blue-100 text-blue-800', executado: 'bg-green-100 text-green-800', recusado: 'bg-red-100 text-red-800' };
const FORM_INICIAL = { numero_nf: '', cliente_nome: '', motorista_nome: '', motivo_descricao: '', valor_cancelado: '', data_cancelamento: new Date().toISOString().split('T')[0], data_retorno_notas: '', observacoes: '' };

export default function ControleCancelamentos() {
  const [busca, setBusca] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const qc = useQueryClient();

  const { data: cancelamentos = [] } = useQuery({
    queryKey: ['cancelamentos'],
    queryFn: () => base44.entities.Cancelamento.list('-data_cancelamento', 200)
  });

  const criar = useMutation({
    mutationFn: (data) => base44.entities.Cancelamento.create({ ...data, numero_cancelamento: `CAN-${Date.now()}` }),
    onSuccess: () => { qc.invalidateQueries(['cancelamentos']); setModalAberto(false); setForm(FORM_INICIAL); toast.success('Cancelamento registrado!'); }
  });

  const filtrados = cancelamentos.filter(c =>
    !busca || c.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) || c.numero_nf?.includes(busca)
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Cancelamentos" icon={XCircle} subtitle="Notas fiscais canceladas" action={() => setModalAberto(true)} actionLabel="Novo Cancelamento" />

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input placeholder="Buscar por cliente ou NF..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-8 h-9" />
      </div>

      <div className="space-y-2">
        {filtrados.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-slate-500 text-sm">Nenhum cancelamento encontrado.</CardContent></Card>
        ) : filtrados.map(c => (
          <Card key={c.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-sm">{c.cliente_nome || '—'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">NF: {c.numero_nf || '—'} · {c.motorista_nome || '—'}</div>
                  <div className="text-xs text-slate-400 mt-1">{c.motivo_descricao}</div>
                </div>
                <div className="text-right">
                  <Badge className={STATUS_CORES[c.status] || 'bg-slate-100'}>{c.status}</Badge>
                  {c.valor_cancelado > 0 && <div className="text-xs font-semibold text-red-600 mt-1">R$ {Number(c.valor_cancelado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>}
                  <div className="text-xs text-slate-400">{c.data_cancelamento && new Date(c.data_cancelamento + 'T12:00:00').toLocaleDateString('pt-BR')}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Cancelamento</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Nº NF</Label><Input value={form.numero_nf} onChange={e => setForm(p => ({ ...p, numero_nf: e.target.value }))} /></div>
              <div><Label className="text-xs">Valor</Label><Input type="number" value={form.valor_cancelado} onChange={e => setForm(p => ({ ...p, valor_cancelado: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Cliente</Label><Input value={form.cliente_nome} onChange={e => setForm(p => ({ ...p, cliente_nome: e.target.value }))} /></div>
            <div><Label className="text-xs">Motorista</Label><Input value={form.motorista_nome} onChange={e => setForm(p => ({ ...p, motorista_nome: e.target.value }))} /></div>
            <div><Label className="text-xs">Motivo</Label><Input value={form.motivo_descricao} onChange={e => setForm(p => ({ ...p, motivo_descricao: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Data Cancelamento</Label><Input type="date" value={form.data_cancelamento} onChange={e => setForm(p => ({ ...p, data_cancelamento: e.target.value }))} /></div>
              <div><Label className="text-xs">Retorno das Notas</Label><Input type="date" value={form.data_retorno_notas} onChange={e => setForm(p => ({ ...p, data_retorno_notas: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Observações</Label><Textarea value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={2} /></div>
            <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white" onClick={() => criar.mutate(form)} disabled={criar.isPending}>Registrar Cancelamento</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}