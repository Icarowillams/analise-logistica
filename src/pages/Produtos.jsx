import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Package, CheckCircle, XCircle, Upload, Tag, Barcode, Image as ImageIcon, List, Save, Ban, Download, ZoomIn, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProdutoConsulta from '@/components/produtos/ProdutoConsulta';
import ExportarProdutosOmieModal from '@/components/produtos/ExportarProdutosOmieModal';

export default function Produtos() {
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [exportOmieOpen, setExportOmieOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    codigo: '',
    nome: '', 
    cod_barras: '',
    ncm: '',
    categoria_id: '', 
    sub_categoria_id: '',
    imagem_url: '',
    estoque_atual: 0, 
    status: 'ativo',
    unidade_medida_id: '',
    unidade_produto_id: '',
    peso: ''
  });

  const queryClient = useQueryClient();

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list()
  });

  const { data: subCategorias = [] } = useQuery({
    queryKey: ['subCategorias'],
    queryFn: () => base44.entities.SubCategoria.list()
  });

  const { data: unidadesMedida = [] } = useQuery({
    queryKey: ['unidadesMedida'],
    queryFn: () => base44.entities.UnidadeMedida.list()
  });

  const { data: unidadesProduto = [] } = useQuery({
    queryKey: ['unidadesProduto'],
    queryFn: () => base44.entities.UnidadeProduto.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Produto.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['produtos']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Produto criado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar produto: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Produto.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['produtos']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Produto atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar produto: ' + error.message);
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
      codigo: '',
      nome: '', 
      cod_barras: '',
      ncm: '',
      categoria_id: '', 
      sub_categoria_id: '',
      imagem_url: '',
      estoque_atual: 0, 
      status: 'ativo',
      unidade_medida_id: '',
      unidade_produto_id: '',
      peso: ''
    });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
      codigo: item.codigo || '',
      nome: item.nome || '',
      cod_barras: item.cod_barras || '',
      ncm: item.ncm || '',
      categoria_id: item.categoria_id || '',
      sub_categoria_id: item.sub_categoria_id || '',
      imagem_url: item.imagem_url || '',
      estoque_atual: item.estoque_atual || 0,
      status: item.status || 'ativo',
      unidade_medida_id: item.unidade_medida_id || '',
      unidade_produto_id: item.unidade_produto_id || '',
      peso: item.peso || ''
    });
    setIsEditing(false);
    setActiveTab("cadastro");
  };

  const handleStartEdit = () => {
    setIsEditing(true);
  };

  const handleDelete = (item) => {
    setSelected(item);
    setDeleteOpen(true);
  };

  const handleCancel = () => {
    resetForm();
    setIsEditing(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {
      ...formData,
      estoque_atual: parseInt(formData.estoque_atual) || 0,
      peso: parseFloat(formData.peso) || 0
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
    } finally {
      setIsUploading(false);
    }
  };

  const handleBulkImport = async (data) => {
    setIsImporting(true);
    for (const item of data) {
      const cat = categorias.find(c => c.nome.toLowerCase() === (item.categoria_nome || '').toLowerCase());
      const subCat = subCategorias.find(sc => sc.nome.toLowerCase() === (item.sub_categoria_nome || '').toLowerCase());
      const unidade = unidadesMedida.find(u => u.nome.toLowerCase() === (item.unidade_medida_nome || '').toLowerCase());
      const unidadeProd = unidadesProduto.find(u => u.nome.toLowerCase() === (item.unidade_produto_nome || '').toLowerCase());
      
      await base44.entities.Produto.create({
        codigo: item.codigo,
        nome: item.nome,
        cod_barras: item.cod_barras,
        ncm: (item.ncm || '').replace(/[^\d]/g, '').substring(0, 8),
        categoria_id: cat ? cat.id : null,
        sub_categoria_id: subCat ? subCat.id : null,
        unidade_medida_id: unidade ? unidade.id : null,
        unidade_produto_id: unidadeProd ? unidadeProd.id : null,
        peso: parseFloat(item.peso) || 0,
        status: item.status || 'ativo',
        estoque_atual: 0 // Default to 0 since removed from import
      });
    }
    queryClient.invalidateQueries(['produtos']);
    setIsImporting(false);
    setBulkOpen(false);
  };

  const bulkColumns = [
    { key: 'codigo', label: 'Código', required: true },
    { key: 'nome', label: 'Nome', required: true },
    { key: 'cod_barras', label: 'Cód. Barras' },
    { key: 'ncm', label: 'NCM (8 dígitos)' },
    { key: 'categoria_nome', label: 'Nome da Categoria' },
    { key: 'sub_categoria_nome', label: 'Nome da Subcategoria' },
    { key: 'unidade_medida_nome', label: 'Nome da Unidade de Medida' },
    { key: 'unidade_produto_nome', label: 'Nome da Unidade de Produto' },
    { key: 'peso', label: 'Peso', type: 'number' },
    { key: 'status', label: 'Status' }
  ];

  const bulkExampleData = [
    { codigo: '001', nome: 'Produto Exemplo 1', cod_barras: '7891234567890', ncm: '19059090', categoria_nome: 'Bebidas', sub_categoria_nome: 'Refrigerantes', unidade_medida_nome: 'UN', unidade_produto_nome: 'FD', peso: '1.5', status: 'ativo' },
    { codigo: '002', nome: 'Produto Exemplo 2', cod_barras: '7890987654321', ncm: '19059090', categoria_nome: 'Alimentos', sub_categoria_nome: 'Massas', unidade_medida_nome: 'KG', unidade_produto_nome: 'UN', peso: '0.5', status: 'ativo' }
  ];

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
            onClick={() => setExportOmieOpen(true)}
            variant="outline"
            className="border-blue-200 text-blue-700 hover:bg-blue-50"
          >
            <Send className="w-4 h-4 mr-2" />
            Exportar Omie
          </Button>
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">
                {!isEditing && selected ? 'Visualizar Produto' : selected ? 'Editar Produto' : 'Novo Produto'}
              </h2>
              <div className="flex items-center gap-2">
                {!isEditing && selected && (
                  <Button
                    type="button"
                    onClick={handleStartEdit}
                    className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Iniciar Edição
                  </Button>
                )}
                {!isEditing && !selected && (
                  <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
                    Modo Visualização
                  </Badge>
                )}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                    <Label htmlFor="image-upload" className={`cursor-pointer ${!isEditing ? 'opacity-50 pointer-events-none' : ''}`}>
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
                        disabled={isUploading || !isEditing}
                      />
                    </Label>
                    <p className="text-xs text-slate-500">JPG, PNG ou GIF. Máx 5MB.</p>
                    {formData.imagem_url && (
                      <div className="flex gap-2 mt-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setImagePreviewOpen(true)}
                          className="text-xs"
                        >
                          <ZoomIn className="w-3 h-3 mr-1" />
                          Visualizar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const link = document.createElement('a');
                            link.href = formData.imagem_url;
                            link.download = `produto_${formData.codigo || 'imagem'}.jpg`;
                            link.click();
                          }}
                          className="text-xs"
                        >
                          <Download className="w-3 h-3 mr-1" />
                          Baixar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <Label>Código *</Label>
                  <Input
                    value={formData.codigo}
                    onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
                    required
                    disabled={!isEditing}
                  />
                </div>
                
                <div>
                  <Label>Nome do Produto *</Label>
                  <Input
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    required
                    disabled={!isEditing}
                  />
                </div>
                
                <div>
                  <Label>Código de Barras</Label>
                  <Input
                    value={formData.cod_barras}
                    onChange={(e) => setFormData({ ...formData, cod_barras: e.target.value })}
                    placeholder="EAN / GTIN"
                    disabled={!isEditing}
                  />
                </div>

                <div>
                  <Label>NCM (Obrigatório Omie)</Label>
                  <Input
                    value={formData.ncm}
                    onChange={(e) => setFormData({ ...formData, ncm: e.target.value.replace(/[^\d]/g, '').substring(0, 8) })}
                    placeholder="Ex: 19059090 (Pães)"
                    maxLength={8}
                    disabled={!isEditing}
                  />
                  <p className="text-xs text-slate-500 mt-1">8 dígitos. Padrão pães: 19059090</p>
                </div>

                <div>
                  <Label>Categoria</Label>
                  <Select 
                    value={formData.categoria_id} 
                    onValueChange={(v) => setFormData({ ...formData, categoria_id: v })}
                    disabled={!isEditing}
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
                  <Label>Subcategoria</Label>
                  <Select 
                    value={formData.sub_categoria_id} 
                    onValueChange={(v) => setFormData({ ...formData, sub_categoria_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {subCategorias
                        .filter(sc => !formData.categoria_id || sc.categoria_id === formData.categoria_id)
                        .map(sc => (
                          <SelectItem key={sc.id} value={sc.id}>{sc.nome}</SelectItem>
                        ))
                      }
                    </SelectContent>
                  </Select>
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

                <div>
                  <Label>Unidade de Medida</Label>
                  <Select 
                    value={formData.unidade_medida_id} 
                    onValueChange={(v) => setFormData({ ...formData, unidade_medida_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {unidadesMedida.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Unidade de Produto</Label>
                  <Select 
                    value={formData.unidade_produto_id} 
                    onValueChange={(v) => setFormData({ ...formData, unidade_produto_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {unidadesProduto.map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Peso</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.peso}
                    onChange={(e) => setFormData({ ...formData, peso: e.target.value })}
                    placeholder="0.00"
                    disabled={!isEditing}
                  />
                </div>
                
                <div>
                  <Label>Estoque Atual</Label>
                  <Input
                    type="number"
                    value={formData.estoque_atual}
                    onChange={(e) => setFormData({ ...formData, estoque_atual: e.target.value })}
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
                    disabled={createMutation.isPending || updateMutation.isPending || isUploading}
                    className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </TabsContent>
        
        <TabsContent value="consulta" className="animate-in fade-in-50 duration-300">
          <ProdutoConsulta onEdit={handleEdit} onDelete={handleDelete} />
        </TabsContent>
      </Tabs>

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

      <ExportarProdutosOmieModal
        open={exportOmieOpen}
        onOpenChange={setExportOmieOpen}
      />

      <Dialog open={imagePreviewOpen} onOpenChange={setImagePreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Imagem do Produto</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            {formData.imagem_url ? (
              <>
                <img 
                  src={formData.imagem_url} 
                  alt={formData.nome || 'Produto'} 
                  className="max-w-full max-h-[70vh] object-contain rounded-lg border"
                />
                <Button
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = formData.imagem_url;
                    link.download = `produto_${formData.codigo || 'imagem'}.jpg`;
                    link.click();
                  }}
                  className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Baixar Imagem
                </Button>
              </>
            ) : (
              <p className="text-slate-500 py-8">Nenhuma imagem disponível</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}