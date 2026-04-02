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
import { ArrowLeftRight, Search } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CORES = { registrada: 'bg-blue-100 text-blue-800', aprovada: 'bg-green-100 text-green-800', recusada: 'bg-red-100 text-red-800', finalizada: 'bg-slate-100 text-slate-700' };
const FORM_INICIAL = { numero_troca: '', data_troca: new Date().toISOString().split('T')[0], cliente_nome: '', motorista_nome: '', motivo_descricao: '', valor_total: '', status: 'registrada', observacoes: '' };

export default function ControleTrocas() {
  const [busca, setBusca] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const qc = useQueryClient();

  const { data: trocas = [] } = useQuery({
    queryKey: ['trocas'],
    queryFn: () => base44.entities.Troca.list('-data_troca', 200)
  });

  const criarTroca = useMutation({
    mutationFn: (data) => base44.entities.Troca.create({ ...data, numero_troca: data.numero_troca || `TRO-${Date.now()}` }),
    onSuccess: () => { qc.invalidateQueries(['trocas']); setModalAberto(false); setForm(FORM_INICIAL); toast.success('Troca registrada!'); }
  });

  const atualizarStatus = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Troca.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries(['trocas']); toast.success('Status atualizado!'); }
  });

  const trocasFiltradas = trocas.filter(t =>
    !busca || t.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) ||
    t.numero_troca?.includes(busca)
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Trocas" icon={ArrowLeftRight} subtitle="Registro de trocas em campo" action={() => setModalAberto(true)} actionLabel="Nova Troca" />

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input placeholder="Buscar por cliente ou número..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-8 h-9" />
      </div>

      <div className="space-y-2">
        {trocasFiltradas.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-slate-500 text-sm">Nenhuma troca encontrada.</CardContent></Card>
        ) : trocasFiltradas.map(t => (
          <Card key={t.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-sm">{t.cliente_nome || '—'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{t.numero_troca} · {t.motorista_nome || '—'}</div>
                  {t.motivo_descricao && <div className="text-xs text-slate-400 mt-1">{t.motivo_descricao}</div>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge className={STATUS_CORES[t.status] || 'bg-slate-100 text-slate-600'}>{t.status}</Badge>
                  {t.valor_total > 0 && <span className="text-xs font-semibold text-amber-600">R$ {Number(t.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                  <Select value={t.status} onValueChange={v => atualizarStatus.mutate({ id: t.id, status: v })}>
                    <SelectTrigger className="h-6 text-xs w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="registrada">Registrada</SelectItem>
                      <SelectItem value="aprovada">Aprovada</SelectItem>
                      <SelectItem value="recusada">Recusada</SelectItem>
                      <SelectItem value="finalizada">Finalizada</SelectItem>
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
          <DialogHeader><DialogTitle>Nova Troca</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Data</Label><Input type="date" value={form.data_troca} onChange={e => setForm(p => ({ ...p, data_troca: e.target.value }))} /></div>
              <div><Label className="text-xs">Valor Total</Label><Input type="number" value={form.valor_total} onChange={e => setForm(p => ({ ...p, valor_total: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Cliente</Label><Input value={form.cliente_nome} onChange={e => setForm(p => ({ ...p, cliente_nome: e.target.value }))} /></div>
            <div><Label className="text-xs">Motorista</Label><Input value={form.motorista_nome} onChange={e => setForm(p => ({ ...p, motorista_nome: e.target.value }))} /></div>
            <div><Label className="text-xs">Motivo</Label><Input value={form.motivo_descricao} onChange={e => setForm(p => ({ ...p, motivo_descricao: e.target.value }))} /></div>
            <div><Label className="text-xs">Observações</Label><Textarea value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={2} /></div>
            <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white" onClick={() => criarTroca.mutate(form)} disabled={criarTroca.isPending}>
              Registrar Troca
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}