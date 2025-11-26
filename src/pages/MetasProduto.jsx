import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Target, TrendingUp } from 'lucide-react';
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

export default function MetasProduto() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    produto_id: '', vendedor_id: '', periodo: '', tipo_periodo: 'mensal', meta_quantidade: 0, meta_valor: 0
  });

  const queryClient = useQueryClient();

  const { data: metas = [], isLoading } = useQuery({ queryKey: ['metasProduto'], queryFn: () => base44.entities.MetaProduto.list() });
  const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: vendas = [] } = useQuery({ queryKey: ['vendas'], queryFn: () => base44.entities.Venda.list('-data', 2000) });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MetaProduto.create(data),
    onSuccess: () => { queryClient.invalidateQueries(['metasProduto']); setFormOpen(false); resetForm(); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MetaProduto.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['metasProduto']); setFormOpen(false); resetForm(); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MetaProduto.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['metasProduto']); setDeleteOpen(false); setSelected(null); }
  });

  const resetForm = () => { setFormData({ produto_id: '', vendedor_id: '', periodo: '', tipo_periodo: 'mensal', meta_quantidade: 0, meta_valor: 0 }); setSelected(null); };
  const handleNew = () => { resetForm(); setFormOpen(true); };
  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
      produto_id: item.produto_id || '', vendedor_id: item.vendedor_id || '', periodo: item.periodo || '',
      tipo_periodo: item.tipo_periodo || 'mensal', meta_quantidade: item.meta_quantidade || 0, meta_valor: item.meta_valor || 0
    });
    setFormOpen(true);
  };
  const handleDelete = (item) => { setSelected(item); setDeleteOpen(true); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const produto = produtos.find(p => p.id === formData.produto_id);
    const vendedor = vendedores.find(v => v.id === formData.vendedor_id);
    const data = {
      ...formData,
      produto_nome: produto?.nome || '',
      vendedor_nome: vendedor?.nome || 'Equipe',
      meta_quantidade: parseFloat(formData.meta_quantidade) || 0,
      meta_valor: parseFloat(formData.meta_valor) || 0
    };
    if (selected) { updateMutation.mutate({ id: selected.id, data }); }
    else { createMutation.mutate(data); }
  };

  const calcularRealizado = (meta) => {
    const vendasFiltradas = vendas.filter(v => {
      const matchProduto = v.produto_id === meta.produto_id;
      const matchVendedor = !meta.vendedor_id || v.vendedor_id === meta.vendedor_id;
      const matchPeriodo = v.data?.startsWith(meta.periodo);
      return matchProduto && matchVendedor && matchPeriodo;
    });
    return {
      quantidade: vendasFiltradas.reduce((sum, v) => sum + (v.quantidade || 0), 0),
      valor: vendasFiltradas.reduce((sum, v) => sum + (v.valor_total || 0), 0)
    };
  };

  const columns = [
    { key: 'periodo', label: 'Período', sortable: true },
    { key: 'produto_nome', label: 'Produto', sortable: true },
    { key: 'vendedor_nome', label: 'Vendedor', render: (v) => v || 'Equipe' },
    { key: 'meta_quantidade', label: 'Meta Qtd' },
    { 
      key: 'atingimento_qtd', 
      label: 'Realizado Qtd',
      render: (_, item) => {
        const { quantidade } = calcularRealizado(item);
        const percent = item.meta_quantidade ? Math.min((quantidade / item.meta_quantidade) * 100, 100) : 0;
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <Progress value={percent} className="h-2 flex-1" />
            <span className="text-xs font-medium w-12">{quantidade}</span>
          </div>
        );
      }
    },
    { key: 'meta_valor', label: 'Meta R$', render: (v) => `R$ ${v?.toLocaleString('pt-BR')}` },
    { 
      key: 'atingimento_valor', 
      label: '% Atingido',
      render: (_, item) => {
        const { valor } = calcularRealizado(item);
        const percent = item.meta_valor ? (valor / item.meta_valor) * 100 : 0;
        return (
          <Badge className={percent >= 100 ? 'bg-emerald-100 text-emerald-700' : percent >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
            {percent.toFixed(0)}%
          </Badge>
        );
      }
    }
  ];

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <div>
      <PageHeader title="Meta por Produto" subtitle="Defina metas de vendas por produto" icon={Target} action={handleNew} actionLabel="Nova Meta" />
      <DataTable data={metas} columns={columns} searchFields={['produto_nome', 'vendedor_nome', 'periodo']} onEdit={handleEdit} onDelete={handleDelete} isLoading={isLoading} />
      
      <FormModal open={formOpen} onOpenChange={setFormOpen} title={selected ? 'Editar Meta' : 'Nova Meta'}>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Produto *</Label>
              <Select value={formData.produto_id} onValueChange={(v) => setFormData({ ...formData, produto_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>{produtos.filter(p => p.status === 'ativo').map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vendedor (vazio = Equipe)</Label>
              <Select value={formData.vendedor_id} onValueChange={(v) => setFormData({ ...formData, vendedor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Todos (Equipe)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Todos (Equipe)</SelectItem>
                  {vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Período *</Label>
              <Input type="month" value={formData.periodo} onChange={(e) => setFormData({ ...formData, periodo: e.target.value })} required />
            </div>
            <div>
              <Label>Tipo Período</Label>
              <Select value={formData.tipo_periodo} onValueChange={(v) => setFormData({ ...formData, tipo_periodo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="mensal">Mensal</SelectItem><SelectItem value="trimestral">Trimestral</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>Meta Quantidade</Label>
              <Input type="number" value={formData.meta_quantidade} onChange={(e) => setFormData({ ...formData, meta_quantidade: e.target.value })} />
            </div>
            <div>
              <Label>Meta Valor (R$)</Label>
              <Input type="number" step="0.01" value={formData.meta_valor} onChange={(e) => setFormData({ ...formData, meta_valor: e.target.value })} />
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