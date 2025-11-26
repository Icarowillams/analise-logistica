import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Route, CheckCircle, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function Rotas() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', vendedor_id: '', frequencia: 'semanal', dia_semana: '', status: 'ativo' });

  const queryClient = useQueryClient();

  const { data: rotas = [], isLoading } = useQuery({ queryKey: ['rotas'], queryFn: () => base44.entities.Rota.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Rota.create(data),
    onSuccess: () => { queryClient.invalidateQueries(['rotas']); setFormOpen(false); resetForm(); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Rota.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['rotas']); setFormOpen(false); resetForm(); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Rota.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['rotas']); setDeleteOpen(false); setSelected(null); }
  });

  const resetForm = () => { setFormData({ nome: '', vendedor_id: '', frequencia: 'semanal', dia_semana: '', status: 'ativo' }); setSelected(null); };
  const handleNew = () => { resetForm(); setFormOpen(true); };
  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ nome: item.nome || '', vendedor_id: item.vendedor_id || '', frequencia: item.frequencia || 'semanal', dia_semana: item.dia_semana || '', status: item.status || 'ativo' });
    setFormOpen(true);
  };
  const handleDelete = (item) => { setSelected(item); setDeleteOpen(true); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selected) { updateMutation.mutate({ id: selected.id, data: formData }); }
    else { createMutation.mutate(formData); }
  };

  const getVendedorNome = (id) => vendedores.find(v => v.id === id)?.nome || '-';

  const diasSemana = { segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado' };
  const frequencias = { semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal' };

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'vendedor_id', label: 'Vendedor', render: (v) => getVendedorNome(v) },
    { key: 'frequencia', label: 'Frequência', render: (v) => frequencias[v] || v },
    { key: 'dia_semana', label: 'Dia', render: (v) => diasSemana[v] || v },
    { key: 'status', label: 'Status', render: (val) => (
      <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
        {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}{val}
      </Badge>
    )}
  ];

  return (
    <div>
      <PageHeader title="Rotas" subtitle="Rotas de visita" icon={Route} action={handleNew} actionLabel="Nova Rota" />
      <DataTable data={rotas} columns={columns} searchFields={['nome']} onEdit={handleEdit} onDelete={handleDelete} isLoading={isLoading} />
      
      <FormModal open={formOpen} onOpenChange={setFormOpen} title={selected ? 'Editar Rota' : 'Nova Rota'}>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2"><Label>Nome *</Label><Input value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} required /></div>
            <div>
              <Label>Vendedor *</Label>
              <Select value={formData.vendedor_id} onValueChange={(v) => setFormData({ ...formData, vendedor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Frequência</Label>
              <Select value={formData.frequencia} onValueChange={(v) => setFormData({ ...formData, frequencia: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="semanal">Semanal</SelectItem><SelectItem value="quinzenal">Quinzenal</SelectItem><SelectItem value="mensal">Mensal</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dia da Semana</Label>
              <Select value={formData.dia_semana} onValueChange={(v) => setFormData({ ...formData, dia_semana: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="segunda">Segunda</SelectItem><SelectItem value="terca">Terça</SelectItem><SelectItem value="quarta">Quarta</SelectItem>
                  <SelectItem value="quinta">Quinta</SelectItem><SelectItem value="sexta">Sexta</SelectItem><SelectItem value="sabado">Sábado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ativo">Ativo</SelectItem><SelectItem value="inativo">Inativo</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="bg-gradient-to-r from-indigo-500 to-purple-600">
              {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </FormModal>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} isDeleting={deleteMutation.isPending} />
    </div>
  );
}