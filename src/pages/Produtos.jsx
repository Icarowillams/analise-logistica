import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Package, Upload, Image as ImageIcon, List, Save, Ban, Download, ZoomIn, Send, RefreshCw, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProdutoConsulta from '@/components/produtos/ProdutoConsulta';
import ExportarProdutosOmieModal from '@/components/produtos/ExportarProdutosOmieModal';
import { useOmiePermissao } from '@/components/hooks/useOmiePermissao';

export default function Produtos() {
  const podeOmie = useOmiePermissao();
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [exportOmieOpen, setExportOmieOpen] = useState(false);
  const [enviandoOmie, setEnviandoOmie] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    codigo: '',
    nome: '', 
    cod_barras: '',
    ncm: '',
    cest: '',
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
      cest: '',
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
      cest: item.cest || '',
      categoria_id: item.categoria_id || '',
      sub_categoria_id: item.sub_categoria_id || '',
      imagem_url: item.imagem_url || '',
      estoque_atual: item.estoque_atual || 0,
      status: item.status || 'ativo',
      unidade_medida_id: item.unidade_medida_id || '',
      unidade_produto_id: item.unidade_produto_id || '',
      peso: item.peso || ''
    });
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleView = (item) => {
    setSelected(item);
    setFormData({
      codigo: item.codigo || '',
      nome: item.nome || '',
      cod_barras: item.cod_barras || '',
      ncm: item.ncm || '',
      cest: item.cest || '',
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

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30 shrink-0">
            <Package className="h-5 w-5 sm:h-6 sm:w-6 text-neutral-900" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight">Produtos</h1>
            <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">Catálogo de produtos</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {podeOmie && (
            <Button
              onClick={() => setExportOmieOpen(true)}
              variant="outline"
              className="border-blue-200 text-blue-700 hover:bg-blue-50 w-full sm:w-auto justify-center"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Sincronizar com Omie
            </Button>
          )}
          <Button
            onClick={handleNew}
            className="w-full sm:w-auto bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30"
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
                  <Label>CEST</Label>
                  <Input
                    value={formData.cest}
                    onChange={(e) => setFormData({ ...formData, cest: e.target.value.replace(/[^\d]/g, '').substring(0, 7) })}
                    placeholder="Ex: 1702100"
                    maxLength={7}
                    disabled={!isEditing}
                  />
                  <p className="text-xs text-slate-500 mt-1">7 dígitos. Código Especificador ST</p>
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
                <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t border-slate-100">
                  <Button type="button" variant="outline" onClick={handleCancel}>
                    <Ban className="w-4 h-4 mr-2" />
                    Cancelar
                  </Button>
                  {selected && selected.tipo !== 'bonificacao' && podeOmie && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={enviandoOmie}
                      className="border-amber-400 text-amber-700 hover:bg-amber-50"
                      onClick={async () => {
                        if (enviandoOmie) return;
                        setEnviandoOmie(true);
                        try {
                          const res = await base44.functions.invoke('enviarProdutoOmie', {
                            event: { type: 'manual', entity_id: selected.id },
                            data: selected
                          });
                          const d = res.data || {};
                          if (d.sucesso) {
                            queryClient.invalidateQueries(['produtos']);
                            if (d.em_processamento) {
                              toast('⏳ Envio já em processamento, aguarde alguns segundos');
                            } else if (d.ja_cadastrado) {
                              toast.success(`✅ Produto já sincronizado no Omie${d.codigo_omie ? ` (código ${d.codigo_omie})` : ''}`);
                            } else {
                              toast.success(`✅ Sincronizado ✓${d.codigo_omie ? ` (código Omie: ${d.codigo_omie})` : ''}`);
                            }
                          } else {
                            toast.error('❌ ' + (d.erro || 'Falha no envio'));
                          }
                        } catch (e) {
                          toast.error('❌ ' + (e?.message || 'Falha no envio'));
                        } finally {
                          setEnviandoOmie(false);
                        }
                      }}
                    >
                      {enviandoOmie ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 mr-2" />
                      )}
                      {enviandoOmie ? 'Enviando…' : 'Enviar ao Omie'}
                    </Button>
                  )}
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
          <ProdutoConsulta 
            onView={handleView}
            onEdit={handleEdit} 
            onDelete={handleDelete} 
          />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
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