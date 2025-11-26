import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowLeftRight } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function MotivosTroca() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ descricao: '', codigo: '', categoria: '' });

  const queryClient = useQueryClient();

  const { data: motivos = [], isLoading } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MotivoTroca.create(data),
    onSuccess: () => { queryClient.invalidateQueries(['motivosTroca']); setFormOpen(false); resetForm(); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MotivoTroca.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['motivosTroca']); setFormOpen(false); resetForm(); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MotivoTroca.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['motivosTroca']); setDeleteOpen(false); setSelected(null); }
  });

  const resetForm = () => { setFormData({ descricao: '', codigo: '', categoria: '' }); setSelected(null); };
  const handleNew = () => { resetForm(); setFormOpen(true); };
  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ descricao: item.descricao || '', codigo: item.codigo || '', categoria: item.categoria || '' });
    setFormOpen(true);
  };
  const handleDelete = (item) => { setSelected(item); setDeleteOpen(true); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selected) { updateMutation.mutate({ id: selected.id, data: formData }); }
    else { createMutation.mutate(formData); }
  };

  const categoriaLabels = {
    defeito: 'Defeito',
    cliente_solicitou: 'Cliente Solicitou',
    vencimento: 'Vencimento',
    estoque: 'Estoque',
    outro: 'Outro'
  };

  const columns = [
    { key: 'codigo', label: 'Código', sortable: true },
    { key: 'descricao', label: 'Descrição', sortable: true },
    { key: 'categoria', label: 'Categoria', render: (val) => <Badge variant="secondary">{categoriaLabels[val] || val}</Badge> }
  ];

  return (
    <div>
      <PageHeader title="Motivos de Troca" subtitle="Razões para trocas de produtos" icon={ArrowLeftRight} action={handleNew} actionLabel="Novo Motivo" />
      <DataTable data={motivos} columns={columns} searchFields={['descricao', 'codigo']} onEdit={handleEdit} onDelete={handleDelete} isLoading={isLoading} />
      
      <FormModal open={formOpen} onOpenChange={setFormOpen} title={selected ? 'Editar Motivo' : 'Novo Motivo'}>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div><Label>Descrição *</Label><Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} required /></div>
          <div><Label>Código *</Label><Input value={formData.codigo} onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} required /></div>
          <div>
            <Label>Categoria</Label>
            <Select value={formData.categoria} onValueChange={(v) => setFormData({ ...formData, categoria: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="defeito">Defeito</SelectItem>
                <SelectItem value="cliente_solicitou">Cliente Solicitou</SelectItem>
                <SelectItem value="vencimento">Vencimento</SelectItem>
                <SelectItem value="estoque">Estoque</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
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