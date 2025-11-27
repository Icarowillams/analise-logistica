import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Tag, CheckCircle, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

export default function Categorias() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', descricao: '', status: 'ativo' });

  const queryClient = useQueryClient();

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Categoria.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['categorias']);
      setFormOpen(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Categoria.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['categorias']);
      setFormOpen(false);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Categoria.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['categorias']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ nome: '', descricao: '', status: 'ativo' });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setFormOpen(true);
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
      nome: item.nome || '',
      descricao: item.descricao || '',
      status: item.status || 'ativo'
    });
    setFormOpen(true);
  };

  const handleDelete = (item) => {
    setSelected(item);
    setDeleteOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selected) {
      updateMutation.mutate({ id: selected.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'descricao', label: 'Descrição' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
          {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
          {val}
        </Badge>
      )
    }
  ];

  return (
    <div>
      <PageHeader 
        title="Categorias" 
        subtitle="Gerencie as categorias de produtos"
        icon={Tag}
        action={handleNew}
        actionLabel="Nova Categoria"
      />

      <DataTable
        data={categorias}
        columns={columns}
        searchFields={['nome', 'descricao']}
        onEdit={handleEdit}
        onDelete={handleDelete}
        isLoading={isLoading}
      />

      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={selected ? 'Editar Categoria' : 'Nova Categoria'}
      >
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <Label>Nome da Categoria *</Label>
            <Input
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              value={formData.descricao}
              onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
              rows={3}
            />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
            >
              {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </FormModal>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}