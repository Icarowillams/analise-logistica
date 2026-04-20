import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { User, Plus, Pencil, Trash2, Save, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';

const initialForm = {
  nome: '', email: '', cpf: '', telefone: '', telefone_2: '',
  cnh_numero: '', cnh_categoria: '', cnh_validade: '',
  veiculo_padrao_id: '', status: 'ativo', observacoes: ''
};

export default function Motoristas() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(initialForm);

  const { data: motoristas = [] } = useQuery({
    queryKey: ['motoristas'],
    queryFn: () => base44.entities.Motorista.list()
  });

  const { data: veiculos = [] } = useQuery({
    queryKey: ['veiculos'],
    queryFn: () => base44.entities.Veiculo.list()
  });

  const saveMutation = useMutation({
    mutationFn: (data) => selected
      ? base44.entities.Motorista.update(selected.id, data)
      : base44.entities.Motorista.create(data),
    onSuccess: () => {
      qc.invalidateQueries(['motoristas']);
      toast.success(selected ? '✅ Motorista atualizado' : '✅ Motorista criado');
      closeModal();
    },
    onError: (e) => toast.error('❌ ' + e.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Motorista.delete(id),
    onSuccess: () => {
      qc.invalidateQueries(['motoristas']);
      toast.success('Motorista excluído');
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const openNew = () => { setSelected(null); setForm(initialForm); setModalOpen(true); };
  const openEdit = (m) => { setSelected(m); setForm({ ...initialForm, ...m }); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setSelected(null); setForm(initialForm); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const veiculo = veiculos.find(v => v.id === form.veiculo_padrao_id);
    saveMutation.mutate({
      ...form,
      veiculo_padrao_placa: veiculo?.placa || ''
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
            <User className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Motoristas</h1>
            <p className="text-sm text-neutral-500">Cadastro de motoristas</p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold">
          <Plus className="w-4 h-4 mr-2" />Novo Motorista
        </Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Nome</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">CPF</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Telefone</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">CNH</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Veículo</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Status</th>
              <th className="text-right p-3 text-xs font-semibold text-slate-600">Ações</th>
            </tr>
          </thead>
          <tbody>
            {motoristas.map(m => (
              <tr key={m.id} className="border-b hover:bg-slate-50">
                <td className="p-3 text-sm font-medium">{m.nome}</td>
                <td className="p-3 text-sm font-mono">{m.cpf || '-'}</td>
                <td className="p-3 text-sm">{m.telefone || '-'}</td>
                <td className="p-3 text-sm">{m.cnh_categoria ? `${m.cnh_categoria} - ${m.cnh_numero || ''}` : '-'}</td>
                <td className="p-3 text-sm font-mono">{m.veiculo_padrao_placa || '-'}</td>
                <td className="p-3"><Badge className={m.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>{m.status}</Badge></td>
                <td className="p-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(m)}><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => { setSelected(m); setDeleteOpen(true); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </td>
              </tr>
            ))}
            {motoristas.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-slate-400">Nenhum motorista cadastrado</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected ? 'Editar Motorista' : 'Novo Motorista'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><Label>Nome *</Label><Input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>CPF</Label><Input value={form.cpf} onChange={e => setForm({ ...form, cpf: e.target.value })} /></div>
              <div><Label>Telefone</Label><Input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
              <div><Label>Telefone 2</Label><Input value={form.telefone_2} onChange={e => setForm({ ...form, telefone_2: e.target.value })} /></div>
              <div><Label>CNH Número</Label><Input value={form.cnh_numero} onChange={e => setForm({ ...form, cnh_numero: e.target.value })} /></div>
              <div><Label>CNH Categoria</Label>
                <Select value={form.cnh_categoria || '_none_'} onValueChange={v => setForm({ ...form, cnh_categoria: v === '_none_' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none_">Nenhuma</SelectItem>
                    {['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>CNH Validade</Label><Input type="date" value={form.cnh_validade} onChange={e => setForm({ ...form, cnh_validade: e.target.value })} /></div>
              <div><Label>Veículo padrão</Label>
                <Select value={form.veiculo_padrao_id || '_none_'} onValueChange={v => setForm({ ...form, veiculo_padrao_id: v === '_none_' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none_">Nenhum</SelectItem>
                    {veiculos.map(v => <SelectItem key={v.id} value={v.id}>{v.placa} - {v.descricao}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                    <SelectItem value="afastado">Afastado</SelectItem>
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