import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Package, CheckCircle, XCircle, Upload } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function Produtos() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    nome: '', sku: '', categoria_id: '', preco_custo: '', preco_venda: '', estoque_atual: 0, status: 'ativo'
  });

  const queryClient = useQueryClient();

  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Produto.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['produtos']);
      setFormOpen(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Produto.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['produtos']);
      setFormOpen(false);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Produto.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['produtos']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ nome: '', sku: '', categoria_id: '', preco_custo: '', preco_venda: '', estoque_atual: 0, status: 'ativo' });
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
      sku: item.sku || '',
      categoria_id: item.categoria_id || '',
      preco_custo: item.preco_custo || '',
      preco_venda: item.preco_venda || '',
      estoque_atual: item.estoque_atual || 0,
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
    const data = {
      ...formData,
      preco_custo: parseFloat(formData.preco_custo) || 0,
      preco_venda: parseFloat(formData.preco_venda) || 0,
      estoque_atual: parseInt(formData.estoque_atual) || 0
    };
    if (selected) {
      updateMutation.mutate({ id: selected.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleBulkImport = async (data) => {
    setIsImporting(true);
    for (const item of data) {
      await base44.entities.Produto.create({
        ...item,
        preco_custo: parseFloat(item.preco_custo) || 0,
        preco_venda: parseFloat(item.preco_venda) || 0,
        estoque_atual: parseInt(item.estoque_atual) || 0,
        status: item.status || 'ativo'
      });
    }
    queryClient.invalidateQueries(['produtos']);
    setIsImporting(false);
    setBulkOpen(false);
  };

  const bulkColumns = [
    { key: 'nome', label: 'Nome', required: true },
    { key: 'sku', label: 'SKU', required: true },
    { key: 'categoria_id', label: 'ID Categoria' },
    { key: 'preco_custo', label: 'Preço Custo', type: 'number' },
    { key: 'preco_venda', label: 'Preço Venda', type: 'number' },
    { key: 'estoque_atual', label: 'Estoque', type: 'number' },
    { key: 'status', label: 'Status' }
  ];

  const bulkExampleData = [
    { nome: 'Produto Exemplo 1', sku: 'SKU-001', categoria_id: 'CAT-ID-1', preco_custo: '25.00', preco_venda: '45.00', estoque_atual: '100', status: 'ativo' },
    { nome: 'Produto Exemplo 2', sku: 'SKU-002', categoria_id: 'CAT-ID-2', preco_custo: '18.50', preco_venda: '32.00', estoque_atual: '200', status: 'ativo' }
  ];

  const getCategoryName = (id) => {
    if (!id) return '-';
    const cat = categorias.find(c => c.id === id);
    return cat ? cat.nome : '-';
  };

  const columns = [
    { key: 'sku', label: 'SKU', sortable: true },
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'categoria_id', label: 'Categoria', render: (val) => getCategoryName(val) },
    { 
      key: 'preco_custo', 
      label: 'Custo',
      render: (val) => val ? `R$ ${parseFloat(val).toFixed(2)}` : '-'
    },
    { 
      key: 'preco_venda', 
      label: 'Venda',
      render: (val) => val ? `R$ ${parseFloat(val).toFixed(2)}` : '-'
    },
    { key: 'estoque_atual', label: 'Estoque' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <Badge className={val === 'ativo' 
          ? 'bg-emerald-100 text-emerald-700 border-emerald-200' 
          : 'bg-slate-100 text-slate-600 border-slate-200'
        }>
          {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
          {val}
        </Badge>
      )
    }
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Package className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Produtos</h1>
            <p className="text-slate-500 mt-0.5">Catálogo de produtos</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setBulkOpen(true)}
            variant="outline"
            className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
          >
            <Upload className="w-4 h-4 mr-2" />
            Importar em Massa
          </Button>
          <Button
            onClick={handleNew}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/30"
          >
            Novo Produto
          </Button>
        </div>
      </div>

      <DataTable
        data={produtos}
        columns={columns}
        searchFields={['nome', 'sku', 'categoria']}
        onEdit={handleEdit}
        onDelete={handleDelete}
        isLoading={isLoading}
      />

      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={selected ? 'Editar Produto' : 'Novo Produto'}
      >
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Nome *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>SKU *</Label>
              <Input
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Categoria</Label>
              <Select 
                value={formData.categoria_id} 
                onValueChange={(v) => setFormData({ ...formData, categoria_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Estoque Atual</Label>
              <Input
                type="number"
                value={formData.estoque_atual}
                onChange={(e) => setFormData({ ...formData, estoque_atual: e.target.value })}
              />
            </div>
            <div>
              <Label>Preço de Custo</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.preco_custo}
                onChange={(e) => setFormData({ ...formData, preco_custo: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Preço de Venda</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.preco_venda}
                onChange={(e) => setFormData({ ...formData, preco_venda: e.target.value })}
                placeholder="0.00"
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
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
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

      <BulkImportModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Importar Produtos em Massa"
        description="Importe vários produtos de uma vez usando CSV ou colando dados do Excel"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
    </div>
  );
}