import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { DollarSign } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function MetasPrecoMedio() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ vendedor_id: '', periodo: '', preco_medio_minimo: 0 });

  const queryClient = useQueryClient();

  const { data: metas = [], isLoading } = useQuery({ queryKey: ['metasPrecoMedio'], queryFn: () => base44.entities.MetaPrecoMedio.list() });
  const { data: vendedoresAll = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: funcoes = [] } = useQuery({ queryKey: ['funcoes'], queryFn: () => base44.entities.Funcao.list() });
  const { data: vendas = [] } = useQuery({ queryKey: ['vendas'], queryFn: () => base44.entities.Venda.list('-data', 2000) });

  const vendedores = useMemo(() => {
    const funcaoVendedor = funcoes.find(f => f.nome?.toLowerCase() === 'vendedor');
    return vendedoresAll.filter(v => {
      if (v.status !== 'ativo') return false;
      if (funcaoVendedor && v.funcao_id === funcaoVendedor.id) return true;
      if (v.funcao?.toLowerCase() === 'vendedor') return true;
      return false;
    });
  }, [vendedoresAll, funcoes]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MetaPrecoMedio.create(data),
    onSuccess: () => { queryClient.invalidateQueries(['metasPrecoMedio']); setFormOpen(false); resetForm(); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MetaPrecoMedio.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['metasPrecoMedio']); setFormOpen(false); resetForm(); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MetaPrecoMedio.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['metasPrecoMedio']); setDeleteOpen(false); setSelected(null); }
  });

  const resetForm = () => { setFormData({ vendedor_id: '', periodo: '', preco_medio_minimo: 0 }); setSelected(null); };
  const handleNew = () => { resetForm(); setFormOpen(true); };
  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ vendedor_id: item.vendedor_id || '', periodo: item.periodo || '', preco_medio_minimo: item.preco_medio_minimo || 0 });
    setFormOpen(true);
  };
  const handleDelete = (item) => { setSelected(item); setDeleteOpen(true); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const vendedor = vendedores.find(v => v.id === formData.vendedor_id);
    const data = { ...formData, vendedor_nome: vendedor?.nome || '', preco_medio_minimo: parseFloat(formData.preco_medio_minimo) || 0 };
    if (selected) { updateMutation.mutate({ id: selected.id, data }); }
    else { createMutation.mutate(data); }
  };

  const calcularTicketMedio = (meta) => {
    const vendasVendedor = vendas.filter(v => v.vendedor_id === meta.vendedor_id && v.data?.startsWith(meta.periodo));
    if (vendasVendedor.length === 0) return 0;
    const total = vendasVendedor.reduce((sum, v) => sum + (v.valor_total || 0), 0);
    return total / vendasVendedor.length;
  };

  const columns = [
    { key: 'periodo', label: 'Período', sortable: true },
    { key: 'vendedor_nome', label: 'Vendedor', sortable: true },
    { key: 'preco_medio_minimo', label: 'Meta Preço Médio', render: (v) => `R$ ${v?.toFixed(2)}` },
    { 
      key: 'ticket_medio_realizado', 
      label: 'Ticket Médio Realizado',
      render: (_, item) => {
        const ticket = calcularTicketMedio(item);
        return `R$ ${ticket.toFixed(2)}`;
      }
    },
    { 
      key: 'variacao', 
      label: 'Variação',
      render: (_, item) => {
        const ticket = calcularTicketMedio(item);
        const variacao = item.preco_medio_minimo ? ((ticket - item.preco_medio_minimo) / item.preco_medio_minimo) * 100 : 0;
        return (
          <Badge className={variacao >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
            {variacao >= 0 ? '+' : ''}{variacao.toFixed(1)}%
          </Badge>
        );
      }
    }
  ];

  return (
    <div>
      <PageHeader title="Meta por Preço Médio" subtitle="Metas de ticket médio por vendedor" icon={DollarSign} action={handleNew} actionLabel="Nova Meta" />
      <DataTable data={metas} columns={columns} searchFields={['vendedor_nome', 'periodo']} onEdit={handleEdit} onDelete={handleDelete} isLoading={isLoading} />
      
      <FormModal open={formOpen} onOpenChange={setFormOpen} title={selected ? 'Editar Meta' : 'Nova Meta'}>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Vendedor *</Label>
              <Select value={formData.vendedor_id} onValueChange={(v) => setFormData({ ...formData, vendedor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Período *</Label>
              <Input type="month" value={formData.periodo} onChange={(e) => setFormData({ ...formData, periodo: e.target.value })} required />
            </div>
            <div>
              <Label>Preço Médio Mínimo (R$) *</Label>
              <Input type="number" step="0.01" value={formData.preco_medio_minimo} onChange={(e) => setFormData({ ...formData, preco_medio_minimo: e.target.value })} required />
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