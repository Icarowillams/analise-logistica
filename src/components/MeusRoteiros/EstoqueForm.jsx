import React, { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Plus, Edit, Trash2, Download, Send, CheckCircle, Camera, Image, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export default function EstoqueForm({ visitaId, clienteId, clienteNome }) {
  const [formData, setFormData] = useState({
    produto_id: '',
    quantidade: '',
    data_validade: '',
    data_fabricacao: '',
    horario_fabricacao: '',
    fotos_urls: []
  });
  const [editingId, setEditingId] = useState(null);
  const [editingLocalIndex, setEditingLocalIndex] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [itensPendentes, setItensPendentes] = useState([]);
  const [enviando, setEnviando] = useState(false);
  
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const queryClient = useQueryClient();

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: subCategorias = [] } = useQuery({
    queryKey: ['subCategorias'],
    queryFn: () => base44.entities.SubCategoria.list()
  });

  // Organizar produtos por subcategoria
  const produtosPorSubcategoria = useMemo(() => {
    const grupos = {};
    const semCategoria = [];
    
    produtos.forEach(p => {
      if (p.sub_categoria_id) {
        if (!grupos[p.sub_categoria_id]) {
          grupos[p.sub_categoria_id] = [];
        }
        grupos[p.sub_categoria_id].push(p);
      } else {
        semCategoria.push(p);
      }
    });

    // Ordenar produtos dentro de cada grupo
    Object.keys(grupos).forEach(key => {
      grupos[key].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    });
    semCategoria.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    return { grupos, semCategoria };
  }, [produtos]);

  const { data: estoques = [] } = useQuery({
    queryKey: ['estoquesVisita', visitaId],
    queryFn: () => base44.entities.EstoqueVisita.filter({ visita_id: visitaId })
  });

  const { data: vendedorAtual } = useQuery({
    queryKey: ['vendedorAtual'],
    queryFn: async () => {
      const user = await base44.auth.me();
      const vendedores = await base44.entities.Vendedor.list();
      return vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
    }
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.EstoqueVisita.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['estoquesVisita']);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.EstoqueVisita.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['estoquesVisita']);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.EstoqueVisita.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['estoquesVisita']);
    }
  });

  const resetForm = () => {
    setFormData({
      produto_id: '',
      quantidade: '',
      data_validade: '',
      data_fabricacao: '',
      horario_fabricacao: '',
      fotos_urls: []
    });
    setEditingId(null);
    setEditingLocalIndex(null);
  };

  const handleDataValidadeChange = (dataValidade) => {
    setFormData({ ...formData, data_validade: dataValidade });
    
    if (dataValidade) {
      const data = new Date(dataValidade);
      data.setDate(data.getDate() - 25);
      const dataFabricacao = data.toISOString().split('T')[0];
      setFormData(prev => ({ ...prev, data_validade: dataValidade, data_fabricacao: dataFabricacao }));
    }
  };

  const handlePhotoUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingPhoto(true);
    try {
      const newUrls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        newUrls.push(file_url);
      }
      setFormData({ ...formData, fotos_urls: [...formData.fotos_urls, ...newUrls] });
    } catch (error) {
      alert('Erro ao fazer upload da foto');
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = (index) => {
    const newUrls = formData.fotos_urls.filter((_, i) => i !== index);
    setFormData({ ...formData, fotos_urls: newUrls });
  };

  const handleSubmit = () => {
    // Se tem produto, precisa de quantidade e dados de fabricação
    if (formData.produto_id) {
      if (!formData.quantidade || !formData.data_fabricacao || !formData.horario_fabricacao) {
        alert('Preencha todos os campos obrigatórios (Quantidade, Data de Fabricação e Horário de Fabricação)');
        return;
      }
    }
    
    // Se não tem produto nem fotos, não pode enviar
    if (!formData.produto_id && formData.fotos_urls.length === 0) {
      alert('Adicione pelo menos um produto ou uma foto');
      return;
    }

    const produto = formData.produto_id ? produtos.find(p => p.id === formData.produto_id) : null;
    
    const data = {
      visita_id: visitaId,
      cliente_id: clienteId,
      cliente_nome: clienteNome,
      produto_id: formData.produto_id || null,
      produto_nome: produto?.nome || 'Foto Avulsa',
      produto_codigo: produto?.codigo || '',
      quantidade: formData.quantidade ? parseFloat(formData.quantidade) : 0,
      data_validade: formData.data_validade || null,
      data_fabricacao: formData.data_fabricacao || null,
      horario_fabricacao: formData.horario_fabricacao || null,
      foto_url: formData.fotos_urls[0] || null,
      fotos_urls: formData.fotos_urls,
      vendedor_id: vendedorAtual?.id || '',
      vendedor_nome: vendedorAtual?.nome || ''
    };

    // Se está editando um item já salvo no banco
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } 
    // Se está editando um item pendente (local)
    else if (editingLocalIndex !== null) {
      const novosItens = [...itensPendentes];
      novosItens[editingLocalIndex] = data;
      setItensPendentes(novosItens);
      resetForm();
    }
    // Adiciona novo item à lista pendente
    else {
      setItensPendentes([...itensPendentes, data]);
      resetForm();
    }
  };

  const handleEditSalvo = (estoque) => {
    setFormData({
      produto_id: estoque.produto_id,
      quantidade: estoque.quantidade,
      data_validade: estoque.data_validade || '',
      data_fabricacao: estoque.data_fabricacao || '',
      horario_fabricacao: estoque.horario_fabricacao || '',
      fotos_urls: estoque.fotos_urls || (estoque.foto_url ? [estoque.foto_url] : [])
    });
    setEditingId(estoque.id);
    setEditingLocalIndex(null);
  };

  const handleEditPendente = (item, index) => {
    setFormData({
      produto_id: item.produto_id,
      quantidade: item.quantidade,
      data_validade: item.data_validade || '',
      data_fabricacao: item.data_fabricacao || '',
      horario_fabricacao: item.horario_fabricacao || '',
      fotos_urls: item.fotos_urls || (item.foto_url ? [item.foto_url] : [])
    });
    setEditingLocalIndex(index);
    setEditingId(null);
  };

  const handleRemovePendente = (index) => {
    const novosItens = itensPendentes.filter((_, i) => i !== index);
    setItensPendentes(novosItens);
  };

  // Enviar apenas os itens pendentes (sem finalizar)
  const handleEnviarSemFinalizar = async () => {
    if (itensPendentes.length === 0) {
      alert('Não há itens pendentes para enviar');
      return;
    }

    setEnviando(true);
    try {
      for (const item of itensPendentes) {
        await base44.entities.EstoqueVisita.create(item);
      }
      setItensPendentes([]);
      queryClient.invalidateQueries(['estoquesVisita']);
      alert('Itens enviados com sucesso!');
    } catch (error) {
      alert('Erro ao enviar itens: ' + error.message);
    } finally {
      setEnviando(false);
    }
  };

  const handleImportarUltimoEstoque = async () => {
    try {
      // Buscar estoques diretamente pelo cliente_id (mais confiável que buscar via visita)
      const todosEstoques = await base44.entities.EstoqueVisita.filter({ 
        cliente_id: clienteId 
      });

      if (todosEstoques.length === 0) {
        alert('Este cliente não possui estoque informado anteriormente.');
        return;
      }

      // Ordenar por data de criação (mais recente primeiro)
      const estoquesOrdenados = todosEstoques.sort((a, b) => 
        new Date(b.created_date) - new Date(a.created_date)
      );

      // Pegar o visita_id do estoque mais recente para agrupar
      const ultimaVisitaId = estoquesOrdenados[0].visita_id;
      
      // Filtrar todos os estoques dessa mesma visita
      const estoquesUltimaVisita = estoquesOrdenados.filter(e => e.visita_id === ultimaVisitaId);

      // Importar como itens pendentes (não salva direto)
      const itensImportados = estoquesUltimaVisita.map(estoque => ({
        visita_id: visitaId,
        cliente_id: clienteId,
        cliente_nome: clienteNome,
        produto_id: estoque.produto_id,
        produto_nome: estoque.produto_nome,
        produto_codigo: estoque.produto_codigo,
        quantidade: estoque.quantidade,
        data_validade: estoque.data_validade,
        data_fabricacao: estoque.data_fabricacao,
        horario_fabricacao: estoque.horario_fabricacao,
        foto_url: null,
        fotos_urls: [],
        vendedor_id: vendedorAtual?.id || '',
        vendedor_nome: vendedorAtual?.nome || ''
      }));

      setItensPendentes([...itensPendentes, ...itensImportados]);
      alert(`${itensImportados.length} itens importados para a lista pendente!`);
    } catch (error) {
      alert('Erro ao importar estoque: ' + error.message);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card className="p-4 bg-slate-50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Adicionar Produtos ao Estoque</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={handleImportarUltimoEstoque}
            className="text-xs"
          >
            <Download className="w-3 h-3 mr-1" />
            Importar Último Estoque
          </Button>
        </div>

        <div className="space-y-3">
          {/* Seção de Fotos - Separada e Independente */}
          <div className="p-3 bg-white rounded-lg border border-slate-200">
            <Label className="text-xs font-medium">Fotos do Estoque</Label>
            <p className="text-xs text-slate-500 mb-2">Você pode enviar apenas fotos ou fotos junto com produto</p>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhotoUpload}
                  className="hidden"
                  disabled={uploadingPhoto}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  disabled={uploadingPhoto}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="flex-1"
                >
                  <Camera className="w-4 h-4 mr-1" />
                  Câmera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="flex-1"
                >
                  <Image className="w-4 h-4 mr-1" />
                  Galeria
                </Button>
              </div>
              {uploadingPhoto && <p className="text-xs text-amber-600">Enviando foto...</p>}
              {formData.fotos_urls.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.fotos_urls.map((url, index) => (
                    <div key={index} className="relative">
                      <img src={url} alt={`Foto ${index + 1}`} className="h-16 w-16 object-cover rounded border" />
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(index)}
                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border-t pt-3">
            <p className="text-xs text-slate-500 mb-2">Opcional: Vincular a um produto</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Produto</Label>
              <Select value={formData.produto_id} onValueChange={(v) => setFormData({ ...formData, produto_id: v })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {/* Produtos sem subcategoria */}
                  {produtosPorSubcategoria.semCategoria.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs text-slate-400">Sem Categoria</SelectLabel>
                      {produtosPorSubcategoria.semCategoria.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {/* Produtos por subcategoria */}
                  {Object.entries(produtosPorSubcategoria.grupos).map(([subCatId, prods]) => {
                    const subCat = subCategorias.find(s => s.id === subCatId);
                    return (
                      <SelectGroup key={subCatId}>
                        <SelectLabel className="text-xs font-semibold text-amber-600">{subCat?.nome || 'Outros'}</SelectLabel>
                        {prods.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Quantidade {formData.produto_id ? '*' : ''}</Label>
              <Input
                type="number"
                value={formData.quantidade}
                onChange={(e) => setFormData({ ...formData, quantidade: e.target.value })}
                placeholder="0"
                className="h-9"
                disabled={!formData.produto_id}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data de Validade {formData.produto_id ? '*' : ''}</Label>
              <Input
                type="date"
                value={formData.data_validade}
                onChange={(e) => handleDataValidadeChange(e.target.value)}
                className="h-9"
                disabled={!formData.produto_id}
              />
            </div>
            <div>
              <Label className="text-xs">Data de Fabricação {formData.produto_id ? '*' : ''}</Label>
              <Input
                type="date"
                value={formData.data_fabricacao}
                onChange={(e) => setFormData({ ...formData, data_fabricacao: e.target.value })}
                className="h-9 bg-slate-100"
                placeholder="Calculado automaticamente"
                disabled={!formData.produto_id}
              />
              {formData.produto_id && <p className="text-xs text-slate-500 mt-1">Calculado: 25 dias antes da validade</p>}
            </div>
          </div>

          <div>
            <Label className="text-xs">Período de Fabricação {formData.produto_id ? '*' : ''}</Label>
            <Select 
              value={formData.horario_fabricacao} 
              onValueChange={(v) => setFormData({ ...formData, horario_fabricacao: v })}
              disabled={!formData.produto_id}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione o período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="madrugada">Madrugada (00h - 06h)</SelectItem>
                <SelectItem value="manha">Manhã (06h - 12h)</SelectItem>
                <SelectItem value="tarde">Tarde (12h - 18h)</SelectItem>
                <SelectItem value="noite">Noite (18h - 00h)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || updateMutation.isPending}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-600 h-9"
          >
            <Plus className="w-4 h-4 mr-2" />
            {editingId ? 'Atualizar Item Salvo' : editingLocalIndex !== null ? 'Atualizar Pendente' : 'Adicionar à Lista'}
          </Button>
        </div>
      </Card>

      {/* Itens Pendentes (não enviados) */}
      {itensPendentes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              Pendentes de Envio ({itensPendentes.length})
            </h4>
            <Button
              onClick={handleEnviarSemFinalizar}
              disabled={enviando}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Send className="w-3 h-3 mr-1" />
              {enviando ? 'Enviando...' : 'Enviar sem Finalizar'}
            </Button>
          </div>
          {itensPendentes.map((item, index) => (
            <Card key={index} className="p-3 border-2 border-dashed border-amber-300 bg-amber-50">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-amber-500 text-white text-xs">Pendente</Badge>
                    <p className="font-medium text-sm">{item.produto_nome}</p>
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500 mt-1">
                    <span>Qtd: {item.quantidade}</span>
                    {item.data_validade && <span>Val: {new Date(item.data_validade).toLocaleDateString('pt-BR')}</span>}
                    {item.horario_fabricacao && <span>Hora: {item.horario_fabricacao}</span>}
                  </div>
                </div>
                {(item.fotos_urls?.length > 0 || item.foto_url) && (
                  <div className="flex gap-1 mr-2">
                    {(item.fotos_urls || [item.foto_url]).filter(Boolean).slice(0, 2).map((url, i) => (
                      <img key={i} src={url} alt={`Foto ${i+1}`} className="h-12 w-12 object-cover rounded" />
                    ))}
                    {(item.fotos_urls?.length || 0) > 2 && (
                      <div className="h-12 w-12 bg-slate-200 rounded flex items-center justify-center text-xs font-medium">
                        +{item.fotos_urls.length - 2}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEditPendente(item, index)} className="h-8 w-8">
                    <Edit className="w-3 h-3" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => handleRemovePendente(index)}
                    className="h-8 w-8 text-red-500"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Itens já enviados/salvos */}
      <div className="space-y-2">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-600" />
          Enviados ({estoques.length})
        </h4>
        {estoques.length === 0 ? (
          <Alert>
            <AlertDescription>Nenhum item enviado ainda</AlertDescription>
          </Alert>
        ) : (
          estoques.map((estoque) => (
            <Card key={estoque.id} className="p-3 bg-slate-100 border-slate-300">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-slate-500 text-white text-xs">Enviado</Badge>
                    <p className="font-medium text-sm text-slate-700">{estoque.produto_nome}</p>
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500 mt-1">
                    <span>Qtd: {estoque.quantidade}</span>
                    {estoque.data_validade && <span>Val: {new Date(estoque.data_validade).toLocaleDateString('pt-BR')}</span>}
                    {estoque.horario_fabricacao && <span>Hora: {estoque.horario_fabricacao}</span>}
                  </div>
                </div>
                {(estoque.fotos_urls?.length > 0 || estoque.foto_url) && (
                  <div className="flex gap-1 mr-2">
                    {(estoque.fotos_urls || [estoque.foto_url]).filter(Boolean).slice(0, 2).map((url, i) => (
                      <img key={i} src={url} alt={`Foto ${i+1}`} className="h-12 w-12 object-cover rounded" />
                    ))}
                    {(estoque.fotos_urls?.length || 0) > 2 && (
                      <div className="h-12 w-12 bg-slate-200 rounded flex items-center justify-center text-xs font-medium">
                        +{estoque.fotos_urls.length - 2}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEditSalvo(estoque)} className="h-8 w-8">
                    <Edit className="w-3 h-3" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => deleteMutation.mutate(estoque.id)}
                    className="h-8 w-8 text-red-500"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}