import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Ban, CheckCircle, CreditCard, Plus, Save, XCircle } from 'lucide-react';

export default function ModalidadePagamentoTab() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', descricao: '', status: 'ativo' });

  const { data: modalidades = [], isLoading } = useQuery({
    queryKey: ['modalidadesPagamento'],
    queryFn: () => base44.entities.ModalidadePagamento.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ModalidadePagamento.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['modalidadesPagamento']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Modalidade criada com sucesso!');
    },
    onError: (error) => toast.error('❌ Erro ao criar modalidade: ' + error.message)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ModalidadePagamento.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['modalidadesPagamento']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Modalidade atualizada com sucesso!');
    },
    onError: (error) => toast.error('❌ Erro ao atualizar modalidade: ' + error.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ModalidadePagamento.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['modalidadesPagamento']);
      setDeleteOpen(false);
      setSelected(null);
      toast.success('✅ Modalidade excluída com sucesso!');
    }
  });

  const resetForm = () => {
    setFormData({ nome: '', descricao: '', status: 'ativo' });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
      nome: item.nome || '',
      descricao: item.descricao || '',
      status: item.status || 'ativo'
    });
    setIsEditing(true);
  };

  const handleCancel = () => {
    resetForm();
    setIsEditing(false);
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
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex justify-end">
        <Button onClick={handleNew} className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Nova Modalidade
        </Button>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">
            {selected ? 'Editar Modalidade de Pagamento' : 'Nova Modalidade de Pagamento'}
          </h2>
          {!isEditing && (
            <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
              Modo Visualização
            </Badge>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Nome *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                required
                disabled={!isEditing}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={formData.status}
                onValueChange={(v) => setFormData({ ...formData, status: v })}
                disabled={!isEditing}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Descrição</Label>
              <Textarea
                value={formData.descricao}
                onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                disabled={!isEditing}
              />
            </div>
          </div>

          {isEditing && (
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={handleCancel}>
                <Ban className="w-4 h-4 mr-2" />
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-gradient-to-r from-indigo-500 to-purple-600"
              >
                <Save className="w-4 h-4 mr-2" />
                {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          )}
        </form>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <DataTable
          data={modalidades}
          columns={columns}
          searchFields={['nome', 'descricao']}
          onEdit={handleEdit}
          onDelete={(item) => {
            setSelected(item);
            setDeleteOpen(true);
          }}
          pageSize={1000}
          isLoading={isLoading}
        />
      </div>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}