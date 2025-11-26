import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { UserPlus } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export default function MetasPositivacao() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ vendedor_id: '', periodo: '', meta_novos_clientes: 0 });

  const queryClient = useQueryClient();

  const { data: metas = [], isLoading } = useQuery({ queryKey: ['metasPositivacao'], queryFn: () => base44.entities.MetaPositivacao.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MetaPositivacao.create(data),
    onSuccess: () => { queryClient.invalidateQueries(['metasPositivacao']); setFormOpen(false); resetForm(); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MetaPositivacao.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['metasPositivacao']); setFormOpen(false); resetForm(); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MetaPositivacao.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['metasPositivacao']); setDeleteOpen(false); setSelected(null); }
  });

  const resetForm = () => { setFormData({ vendedor_id: '', periodo: '', meta_novos_clientes: 0 }); setSelected(null); };
  const handleNew = () => { resetForm(); setFormOpen(true); };
  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ vendedor_id: item.vendedor_id || '', periodo: item.periodo || '', meta_novos_clientes: item.meta_novos_clientes || 0 });
    setFormOpen(true);
  };
  const handleDelete = (item) => { setSelected(item); setDeleteOpen(true); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const vendedor = vendedores.find(v => v.id === formData.vendedor_id);
    const data = { ...formData, vendedor_nome: vendedor?.nome || '', meta_novos_clientes: parseInt(formData.meta_novos_clientes) || 0 };
    if (selected) { updateMutation.mutate({ id: selected.id, data }); }
    else { createMutation.mutate(data); }
  };

  // Simulação: contar clientes criados no período (data_primeiro_contato)
  const calcularRealizado = (meta) => {
    const novosClientes = clientes.filter(c => c.data_primeiro_contato?.startsWith(meta.periodo)).length;
    return novosClientes;
  };

  const columns = [
    { key: 'periodo', label: 'Período', sortable: true },
    { key: 'vendedor_nome', label: 'Vendedor', sortable: true },
    { key: 'meta_novos_clientes', label: 'Meta Novos Clientes' },
    { 
      key: 'realizado', 
      label: 'Realizado',
      render: (_, item) => {
        const realizado = calcularRealizado(item);
        const percent = item.meta_novos_clientes ? Math.min((realizado / item.meta_novos_clientes) * 100, 100) : 0;
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <Progress value={percent} className="h-2 flex-1" />
            <span className="text-xs font-medium">{realizado}</span>
          </div>
        );
      }
    },
    { 
      key: 'atingimento', 
      label: '% Atingido',
      render: (_, item) => {
        const realizado = calcularRealizado(item);
        const percent = item.meta_novos_clientes ? (realizado / item.meta_novos_clientes) * 100 : 0;
        return (
          <Badge className={percent >= 100 ? 'bg-emerald-100 text-emerald-700' : percent >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
            {percent.toFixed(0)}%
          </Badge>
        );
      }
    }
  ];

  return (
    <div>
      <PageHeader title="Meta por Positivação" subtitle="Metas de conquista de novos clientes" icon={UserPlus} action={handleNew} actionLabel="Nova Meta" />
      <DataTable data={metas} columns={columns} searchFields={['vendedor_nome', 'periodo']} onEdit={handleEdit} onDelete={handleDelete} isLoading={isLoading} />
      
      <FormModal open={formOpen} onOpenChange={setFormOpen} title={selected ? 'Editar Meta' : 'Nova Meta'}>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Vendedor *</Label>
              <Select value={formData.vendedor_id} onValueChange={(v) => setFormData({ ...formData, vendedor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Período *</Label>
              <Input type="month" value={formData.periodo} onChange={(e) => setFormData({ ...formData, periodo: e.target.value })} required />
            </div>
            <div>
              <Label>Meta Novos Clientes *</Label>
              <Input type="number" value={formData.meta_novos_clientes} onChange={(e) => setFormData({ ...formData, meta_novos_clientes: e.target.value })} required />
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