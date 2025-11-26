import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { CreditCard, CheckCircle, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

export default function PlanosPagamento() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', numero_parcelas: 1, juros_percentual: 0, dias_primeira_parcela: 30, condicoes: '', status: 'ativo' });

  const queryClient = useQueryClient();

  const { data: planos = [], isLoading } = useQuery({
    queryKey: ['planosPagamento'],
    queryFn: () => base44.entities.PlanoPagamento.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.PlanoPagamento.create(data),
    onSuccess: () => { queryClient.invalidateQueries(['planosPagamento']); setFormOpen(false); resetForm(); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PlanoPagamento.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['planosPagamento']); setFormOpen(false); resetForm(); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PlanoPagamento.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['planosPagamento']); setDeleteOpen(false); setSelected(null); }
  });

  const resetForm = () => { setFormData({ nome: '', numero_parcelas: 1, juros_percentual: 0, dias_primeira_parcela: 30, condicoes: '', status: 'ativo' }); setSelected(null); };
  const handleNew = () => { resetForm(); setFormOpen(true); };
  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
      nome: item.nome || '', numero_parcelas: item.numero_parcelas || 1, juros_percentual: item.juros_percentual || 0,
      dias_primeira_parcela: item.dias_primeira_parcela || 30, condicoes: item.condicoes || '', status: item.status || 'ativo'
    });
    setFormOpen(true);
  };
  const handleDelete = (item) => { setSelected(item); setDeleteOpen(true); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { ...formData, numero_parcelas: parseInt(formData.numero_parcelas), juros_percentual: parseFloat(formData.juros_percentual), dias_primeira_parcela: parseInt(formData.dias_primeira_parcela) };
    if (selected) { updateMutation.mutate({ id: selected.id, data }); }
    else { createMutation.mutate(data); }
  };

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'numero_parcelas', label: 'Parcelas' },
    { key: 'juros_percentual', label: 'Juros (%)', render: (v) => `${v || 0}%` },
    { key: 'dias_primeira_parcela', label: 'Dias 1ª Parcela' },
    { key: 'status', label: 'Status', render: (val) => (
      <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
        {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}{val}
      </Badge>
    )}
  ];

  return (
    <div>
      <PageHeader title="Planos de Pagamento" subtitle="Condições comerciais" icon={CreditCard} action={handleNew} actionLabel="Novo Plano" />
      <DataTable data={planos} columns={columns} searchFields={['nome']} onEdit={handleEdit} onDelete={handleDelete} isLoading={isLoading} />
      
      <FormModal open={formOpen} onOpenChange={setFormOpen} title={selected ? 'Editar Plano' : 'Novo Plano'}>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2"><Label>Nome *</Label><Input value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} required /></div>
            <div><Label>Número de Parcelas *</Label><Input type="number" min="1" value={formData.numero_parcelas} onChange={(e) => setFormData({ ...formData, numero_parcelas: e.target.value })} required /></div>
            <div><Label>Juros (%)</Label><Input type="number" step="0.01" value={formData.juros_percentual} onChange={(e) => setFormData({ ...formData, juros_percentual: e.target.value })} /></div>
            <div><Label>Dias para 1ª Parcela</Label><Input type="number" value={formData.dias_primeira_parcela} onChange={(e) => setFormData({ ...formData, dias_primeira_parcela: e.target.value })} /></div>
            <div><Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ativo">Ativo</SelectItem><SelectItem value="inativo">Inativo</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>Condições</Label><Textarea value={formData.condicoes} onChange={(e) => setFormData({ ...formData, condicoes: e.target.value })} /></div>
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