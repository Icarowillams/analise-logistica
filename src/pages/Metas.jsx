import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Target, Plus, Trash2, Pencil } from 'lucide-react';
import { formatarMoeda, formatarNumero } from '@/components/analises/utilsAnalises';

const inicial = { titulo: '', tipo: 'vendas', vendedor_id: '', periodo_inicio: '', periodo_fim: '', valor_meta: 0, valor_realizado: 0, premiacao: '', observacoes: '', status: 'ativa' };

export default function Metas() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(inicial);

  const { data: metas = [] } = useQuery({ queryKey: ['metas'], queryFn: () => base44.entities.Meta.list('-periodo_inicio', 500) });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });

  const salvar = useMutation({
    mutationFn: async (data) => {
      const vendedor = vendedores.find(v => v.id === data.vendedor_id);
      const supervisor = vendedores.find(v => v.id === vendedor?.supervisor_id);
      const perc = data.valor_meta > 0 ? Math.round((data.valor_realizado / data.valor_meta) * 1000) / 10 : 0;
      const payload = { ...data, vendedor_nome: vendedor?.nome || '', supervisor_id: vendedor?.supervisor_id || '', supervisor_nome: supervisor?.nome || '', percentual_atingido: perc };
      return edit ? base44.entities.Meta.update(edit.id, payload) : base44.entities.Meta.create(payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['metas'] }); toast.success('Meta salva'); setOpen(false); setEdit(null); setForm(inicial); },
    onError: (e) => toast.error('Erro: ' + e.message)
  });

  const excluir = useMutation({
    mutationFn: (id) => base44.entities.Meta.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['metas'] }); toast.success('Meta excluída'); }
  });

  const abrirNovo = () => { setEdit(null); setForm(inicial); setOpen(true); };
  const abrirEdit = (m) => { setEdit(m); setForm({ ...inicial, ...m }); setOpen(true); };

  const ativas = metas.filter(m => m.status === 'ativa').length;
  const concluidas = metas.filter(m => m.status === 'concluida').length;
  const mediaAtingida = metas.length ? Math.round(metas.reduce((a, m) => a + (m.percentual_atingido || 0), 0) / metas.length) : 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <PageHeader title="Metas" subtitle="Cadastro e acompanhamento de metas comerciais" icon={Target} />
        <Button onClick={abrirNovo} className="bg-amber-500 hover:bg-amber-600 text-neutral-900"><Plus className="w-4 h-4" />Nova Meta</Button>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Card className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white border-0"><CardContent className="p-4"><p className="text-xs opacity-80">Metas Ativas</p><p className="text-3xl font-bold">{ativas}</p></CardContent></Card>
        <Card className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-0"><CardContent className="p-4"><p className="text-xs opacity-80">Concluídas</p><p className="text-3xl font-bold">{concluidas}</p></CardContent></Card>
        <Card className="bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white border-0"><CardContent className="p-4"><p className="text-xs opacity-80">% Médio Atingido</p><p className="text-3xl font-bold">{mediaAtingida}%</p></CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-base">Metas cadastradas</CardTitle></CardHeader><CardContent className="space-y-2">
        {metas.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Nenhuma meta cadastrada</p>}
        {metas.map(m => (
          <div key={m.id} className="rounded-lg border p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2"><p className="font-semibold">{m.titulo}</p><Badge>{m.tipo}</Badge><Badge variant="outline">{m.status}</Badge></div>
                <p className="text-xs text-slate-500 mt-1">{m.vendedor_nome || 'Geral'} • {m.periodo_inicio} a {m.periodo_fim}</p>
              </div>
              <div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => abrirEdit(m)}><Pencil className="w-4 h-4" /></Button><Button size="icon" variant="ghost" onClick={() => excluir.mutate(m.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button></div>
            </div>
            <div className="mt-2 flex justify-between text-sm"><span>{formatarMoeda(m.valor_realizado)} de {formatarMoeda(m.valor_meta)}</span><span className="font-bold text-emerald-600">{m.percentual_atingido || 0}%</span></div>
            <div className="h-2 bg-slate-100 rounded mt-1 overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${Math.min(m.percentual_atingido || 0, 100)}%` }} /></div>
          </div>
        ))}
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{edit ? 'Editar' : 'Nova'} Meta</DialogTitle></DialogHeader>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><Label>Título</Label><Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></div>
            <div><Label>Tipo</Label><Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="vendas">Vendas (R$)</SelectItem><SelectItem value="visitas">Visitas</SelectItem><SelectItem value="clientes_novos">Clientes novos</SelectItem><SelectItem value="ticket_medio">Ticket médio</SelectItem><SelectItem value="trocas_max">Trocas máx</SelectItem></SelectContent></Select></div>
            <div><Label>Vendedor</Label><Select value={form.vendedor_id || '_g_'} onValueChange={(v) => setForm({ ...form, vendedor_id: v === '_g_' ? '' : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="_g_">Geral / Equipe</SelectItem>{vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Período Início</Label><Input type="date" value={form.periodo_inicio} onChange={(e) => setForm({ ...form, periodo_inicio: e.target.value })} /></div>
            <div><Label>Período Fim</Label><Input type="date" value={form.periodo_fim} onChange={(e) => setForm({ ...form, periodo_fim: e.target.value })} /></div>
            <div><Label>Valor da Meta</Label><Input type="number" step="0.01" value={form.valor_meta} onChange={(e) => setForm({ ...form, valor_meta: Number(e.target.value) })} /></div>
            <div><Label>Realizado</Label><Input type="number" step="0.01" value={form.valor_realizado} onChange={(e) => setForm({ ...form, valor_realizado: Number(e.target.value) })} /></div>
            <div><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ativa">Ativa</SelectItem><SelectItem value="concluida">Concluída</SelectItem><SelectItem value="cancelada">Cancelada</SelectItem></SelectContent></Select></div>
            <div><Label>Premiação</Label><Input value={form.premiacao} onChange={(e) => setForm({ ...form, premiacao: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>Observações</Label><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => salvar.mutate(form)} className="bg-amber-500 text-neutral-900 hover:bg-amber-600">Salvar</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}