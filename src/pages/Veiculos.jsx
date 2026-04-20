import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Truck, Plus, Pencil, Trash2, Save, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';

const initialForm = {
  placa: '', descricao: '', marca: '', modelo: '', ano: '', cor: '', tipo: 'vuc',
  capacidade_peso_kg: '', capacidade_volume_m3: '', capacidade_caixas: '',
  horario_inicio: '', horario_fim: '',
  status: 'disponivel', km_atual: '', observacoes: ''
};

export default function Veiculos() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(initialForm);

  const { data: veiculos = [] } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list()
  });

  const saveMutation = useMutation({
    mutationFn: (data) => selected
      ? base44.entities.Veiculo.update(selected.id, data)
      : base44.entities.Veiculo.create(data),
    onSuccess: () => {
      qc.invalidateQueries(['veiculos']);
      toast.success(selected ? '✅ Veículo atualizado' : '✅ Veículo criado');
      closeModal();
    },
    onError: (e) => toast.error('❌ ' + e.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Veiculo.delete(id),
    onSuccess: () => {
      qc.invalidateQueries(['veiculos']);
      toast.success('Veículo excluído');
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const openNew = () => { setSelected(null); setForm(initialForm); setModalOpen(true); };
  const openEdit = (v) => { setSelected(v); setForm({ ...initialForm, ...v }); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setSelected(null); setForm(initialForm); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {
      ...form,
      ano: form.ano ? Number(form.ano) : undefined,
      capacidade_peso_kg: form.capacidade_peso_kg ? Number(form.capacidade_peso_kg) : undefined,
      capacidade_volume_m3: form.capacidade_volume_m3 ? Number(form.capacidade_volume_m3) : undefined,
      capacidade_caixas: form.capacidade_caixas ? Number(form.capacidade_caixas) : undefined,
      km_atual: form.km_atual ? Number(form.km_atual) : undefined
    };
    saveMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
            <Truck className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Veículos</h1>
            <p className="text-sm text-neutral-500">Cadastro da frota</p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold">
          <Plus className="w-4 h-4 mr-2" />Novo Veículo
        </Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Placa</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Descrição</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Tipo</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Capacidade</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Status</th>
              <th className="text-right p-3 text-xs font-semibold text-slate-600">Ações</th>
            </tr>
          </thead>
          <tbody>
            {veiculos.map(v => (
              <tr key={v.id} className="border-b hover:bg-slate-50">
                <td className="p-3 text-sm font-mono font-semibold">{v.placa}</td>
                <td className="p-3 text-sm">{v.descricao || '-'}</td>
                <td className="p-3 text-sm"><Badge variant="outline">{v.tipo}</Badge></td>
                <td className="p-3 text-sm text-slate-600">{v.capacidade_peso_kg ? `${v.capacidade_peso_kg} kg` : '-'}</td>
                <td className="p-3"><Badge className={v.status === 'disponivel' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>{v.status}</Badge></td>
                <td className="p-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(v)}><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => { setSelected(v); setDeleteOpen(true); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </td>
              </tr>
            ))}
            {veiculos.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">Nenhum veículo cadastrado</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected ? 'Editar Veículo' : 'Novo Veículo'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Placa *</Label><Input required value={form.placa} onChange={e => setForm({ ...form, placa: e.target.value.toUpperCase() })} /></div>
              <div><Label>Tipo</Label>
                <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['vuc', 'van', 'truck', 'toco', 'bitruck', 'carreta', 'moto', 'utilitario', 'outro'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Label>Descrição</Label><Input value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} placeholder="Ex: VUC Iveco Daily Branco" /></div>
              <div><Label>Marca</Label><Input value={form.marca} onChange={e => setForm({ ...form, marca: e.target.value })} /></div>
              <div><Label>Modelo</Label><Input value={form.modelo} onChange={e => setForm({ ...form, modelo: e.target.value })} /></div>
              <div><Label>Ano</Label><Input type="number" value={form.ano} onChange={e => setForm({ ...form, ano: e.target.value })} /></div>
              <div><Label>Cor</Label><Input value={form.cor} onChange={e => setForm({ ...form, cor: e.target.value })} /></div>
              <div><Label>Capacidade (kg)</Label><Input type="number" value={form.capacidade_peso_kg} onChange={e => setForm({ ...form, capacidade_peso_kg: e.target.value })} /></div>
              <div><Label>Volume (m³)</Label><Input type="number" step="0.01" value={form.capacidade_volume_m3} onChange={e => setForm({ ...form, capacidade_volume_m3: e.target.value })} /></div>
              <div><Label>Capacidade caixas</Label><Input type="number" value={form.capacidade_caixas} onChange={e => setForm({ ...form, capacidade_caixas: e.target.value })} /></div>
              <div><Label>KM atual</Label><Input type="number" value={form.km_atual} onChange={e => setForm({ ...form, km_atual: e.target.value })} /></div>
              <div><Label>Horário início</Label><Input type="time" value={form.horario_inicio} onChange={e => setForm({ ...form, horario_inicio: e.target.value })} /></div>
              <div><Label>Horário fim</Label><Input type="time" value={form.horario_fim} onChange={e => setForm({ ...form, horario_fim: e.target.value })} /></div>
              <div className="col-span-2"><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disponivel">Disponível</SelectItem>
                    <SelectItem value="em_rota">Em rota</SelectItem>
                    <SelectItem value="manutencao">Manutenção</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Label>Observações</Label><Textarea rows={2} value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeModal}><Ban className="w-4 h-4 mr-2" />Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending}><Save className="w-4 h-4 mr-2" />Salvar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}