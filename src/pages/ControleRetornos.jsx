import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RotateCcw, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';

const FORM_INICIAL = {
  numero_retorno: '', numero_nf: '', cliente_nome: '', motorista_nome: '',
  data_retorno: new Date().toISOString().split('T')[0],
  horario_retorno: '', valor_retorno: '', motivo_descricao: '', observacoes: ''
};

export default function ControleRetornos() {
  const [busca, setBusca] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const qc = useQueryClient();

  const { data: retornos = [] } = useQuery({
    queryKey: ['retornos'],
    queryFn: () => base44.entities.Retorno.list('-data_retorno', 200)
  });

  const criarRetorno = useMutation({
    mutationFn: (data) => base44.entities.Retorno.create({ ...data, numero_retorno: data.numero_retorno || `RET-${Date.now()}` }),
    onSuccess: () => { qc.invalidateQueries(['retornos']); setModalAberto(false); setForm(FORM_INICIAL); toast.success('Retorno registrado!'); }
  });

  const retornosFiltrados = retornos.filter(r =>
    !busca || r.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) ||
    r.numero_nf?.includes(busca) || r.motorista_nome?.toLowerCase().includes(busca.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Retornos" icon={RotateCcw} subtitle="Controle de notas fiscais retornadas" action={() => setModalAberto(true)} actionLabel="Novo Retorno" />

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input placeholder="Buscar por cliente, NF ou motorista..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-8 h-9" />
      </div>

      <div className="space-y-2">
        {retornosFiltrados.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-slate-500 text-sm">Nenhum retorno encontrado.</CardContent></Card>
        ) : retornosFiltrados.map(r => (
          <Card key={r.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-sm">{r.cliente_nome || '—'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">NF: {r.numero_nf || '—'} · {r.motorista_nome || '—'}</div>
                  {r.motivo_descricao && <div className="text-xs text-slate-400 mt-1">{r.motivo_descricao}</div>}
                </div>
                <div className="text-right">
                  {r.valor_retorno > 0 && <div className="font-semibold text-sm text-amber-600">R$ {Number(r.valor_retorno).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>}
                  <div className="text-xs text-slate-400">{r.data_retorno && new Date(r.data_retorno + 'T12:00:00').toLocaleDateString('pt-BR')}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Retorno</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Nº NF</Label><Input value={form.numero_nf} onChange={e => setForm(p => ({ ...p, numero_nf: e.target.value }))} /></div>
              <div><Label className="text-xs">Data Retorno</Label><Input type="date" value={form.data_retorno} onChange={e => setForm(p => ({ ...p, data_retorno: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Cliente</Label><Input value={form.cliente_nome} onChange={e => setForm(p => ({ ...p, cliente_nome: e.target.value }))} /></div>
            <div><Label className="text-xs">Motorista</Label><Input value={form.motorista_nome} onChange={e => setForm(p => ({ ...p, motorista_nome: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Valor</Label><Input type="number" value={form.valor_retorno} onChange={e => setForm(p => ({ ...p, valor_retorno: e.target.value }))} /></div>
              <div><Label className="text-xs">Horário</Label><Input type="time" value={form.horario_retorno} onChange={e => setForm(p => ({ ...p, horario_retorno: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Motivo</Label><Input value={form.motivo_descricao} onChange={e => setForm(p => ({ ...p, motivo_descricao: e.target.value }))} /></div>
            <div><Label className="text-xs">Observações</Label><Textarea value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={2} /></div>
            <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white" onClick={() => criarRetorno.mutate(form)} disabled={criarRetorno.isPending}>
              Registrar Retorno
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}