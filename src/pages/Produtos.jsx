import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Package, CheckCircle, XCircle, Upload, Tag, Barcode, Image as ImageIcon, List } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProdutoConsulta from '@/components/produtos/ProdutoConsulta';

export default function Produtos() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    nome: '', 
    sku: '', 
    cod_barras: '',
    categoria_id: '', 
    imagem_url: '',
    preco_custo: '', 
    preco_venda: '', 
    estoque_atual: 0, 
    status: 'ativo'
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
    setFormData({ 
      nome: '', 
      sku: '', 
      cod_barras: '',
      categoria_id: '', 
      imagem_url: '',
      preco_custo: '', 
      preco_venda: '', 
      estoque_atual: 0, 
      status: 'ativo' 
    });
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
      cod_barras: item.cod_barras || '',
      categoria_id: item.categoria_id || '',
      imagem_url: item.imagem_url || '',
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

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const response = await base44.integrations.Core.UploadFile({ file });
      if (response && response.file_url) {
        setFormData(prev => ({ ...prev, imagem_url: response.file_url }));
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      // Optionally handle error (toast, etc.)
    } finally {
      setIsUploading(false);
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
    { key: 'cod_barras', label: 'Cód. Barras' },
    { key: 'categoria_id', label: 'ID Categoria' },
    { key: 'preco_custo', label: 'Preço Custo', type: 'number' },
    { key: 'preco_venda', label: 'Preço Venda', type: 'number' },
    { key: 'estoque_atual', label: 'Estoque', type: 'number' },
    { key: 'status', label: 'Status' }
  ];

  const bulkExampleData = [
    { nome: 'Produto Exemplo 1', sku: 'SKU-001', cod_barras: '7891234567890', categoria_id: 'CAT-ID-1', preco_custo: '25.00', preco_venda: '45.00', estoque_atual: '100', status: 'ativo' },
    { nome: 'Produto Exemplo 2', sku: 'SKU-002', cod_barras: '7890987654321', categoria_id: 'CAT-ID-2', preco_custo: '18.50', preco_venda: '32.00', estoque_atual: '200', status: 'ativo' }
  ];

  const getCategoryName = (id) => {
    if (!id) return '-';
    const cat = categorias.find(c => c.id === id);
    return cat ? cat.nome : '-';
  };

  const getStatusBadge = (status) => {
    const styles = {
      ativo: { class: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle },
      inativo: { class: 'bg-slate-100 text-slate-600 border-slate-200', icon: XCircle }
    };
    const s = styles[status] || styles.ativo;
    return (
      <Badge className={s.class}>
        <s.icon className="w-3 h-3 mr-1" />
        {status}
      </Badge>
    );
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Package className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Produtos</h1>
            <p className="text-neutral-500 mt-0.5">Catálogo de produtos</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setBulkOpen(true)}
            variant="outline"
            className="border-amber-200 text-amber-700 hover:bg-amber-50"
          >
            <Upload className="w-4 h-4 mr-2" />
            Importar em Massa
          </Button>
          <Button
            onClick={handleNew}
            className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30"
          >
            Novo Produto
          </Button>
        </div>
      </div>

      <Tabs defaultValue="cadastro" className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Cadastro
          </TabsTrigger>
          <TabsTrigger value="consulta" className="flex items-center gap-2">
            <List className="w-4 h-4" />
            Consulta
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="cadastro" className="space-y-6 animate-in fade-in-50 duration-300">
          {/* Grid View for visual organization */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {produtos.map((produto) => (
              <div key={produto.id} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 hover:shadow-md transition-shadow group relative flex flex-col">
                <div className="aspect-video w-full rounded-lg bg-slate-50 mb-3 overflow-hidden flex items-center justify-center border border-slate-100">
                  {produto.imagem_url ? (
                    <img src={produto.imagem_url} alt={produto.nome} className="w-full h-full object-cover" />
                  ) : (
                    <Package className="w-12 h-12 text-slate-200" />
                  )}
                </div>

                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-bold text-slate-900 line-clamp-1" title={produto.nome}>
                    {produto.nome}
                  </h3>
                </div>
                
                <div className="space-y-1 text-sm text-slate-600 flex-1">
                   <div className="flex items-center gap-2 text-xs">
                    <Tag className="w-3 h-3 text-slate-400" />
                    <span className="truncate">{getCategoryName(produto.categoria_id)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Barcode className="w-3 h-3 text-slate-400" />
                    <span className="truncate">{produto.cod_barras || produto.sku || '-'}</span>
                  </div>
                   <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-50">
                      <span className="font-semibold text-slate-900">R$ {produto.preco_venda?.toFixed(2)}</span>
                      {getStatusBadge(produto.status)}
                   </div>
                </div>

                {/* Edit and Delete buttons removed from here as requested */}
              </div>
            ))}
          </div>
          
          {produtos.length === 0 && !isLoading && (
            <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-200">
              <p>Nenhum produto cadastrado.</p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="consulta" className="animate-in fade-in-50 duration-300">
          <ProdutoConsulta onEdit={handleEdit} onDelete={handleDelete} />
        </TabsContent>
      </Tabs>

      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={selected ? 'Editar Produto' : 'Novo Produto'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Image Upload Section - Full Width */}
            <div className="md:col-span-2 flex items-center gap-4 p-4 border border-slate-200 rounded-lg bg-slate-50">
              <div className="w-24 h-24 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                {formData.imagem_url ? (
                  <img src={formData.imagem_url} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-slate-300" />
                )}
              </div>
              <div className="flex-1">
                <Label htmlFor="image-upload" className="cursor-pointer">
                  <div className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 mb-1">
                    <Upload className="w-4 h-4" />
                    {isUploading ? 'Enviando...' : 'Carregar Imagem'}
                  </div>
                  <input 
                    id="image-upload" 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleImageUpload}
                    disabled={isUploading}
                  />
                </Label>
                <p className="text-xs text-slate-500">JPG, PNG ou GIF. Máx 5MB.</p>
              </div>
            </div>

            <div className="md:col-span-2">
              <Label>Nome do Produto *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                required
              />
            </div>
            
            <div>
              <Label>Código de Barras</Label>
              <Input
                value={formData.cod_barras}
                onChange={(e) => setFormData({ ...formData, cod_barras: e.target.value })}
                placeholder="EAN / GTIN"
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
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending || updateMutation.isPending || isUploading}
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