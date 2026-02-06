import React, { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Plus, Edit, Trash2, Send, CheckCircle, Download, Camera, Image, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

export default function TrocasForm({ visitaId, clienteId, clienteNome }) {
  const [formData, setFormData] = useState({
    produto_id: '',
    quantidade: '',
    data_validade: '',
    data_fabricacao: '',
    horario_fabricacao: '',
    motivo_troca: '',
    ja_informado_anteriormente: false,
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

  const { data: motivos = [] } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
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

  const { data: trocas = [] } = useQuery({
    queryKey: ['trocasVisita', visitaId],
    queryFn: () => base44.entities.TrocaVisita.filter({ visita_id: visitaId })
  });

  // Buscar última troca do cliente
  const { data: ultimasTrocas = [] } = useQuery({
    queryKey: ['ultimasTrocasCliente', clienteId],
    queryFn: () => base44.entities.TrocaVisita.filter({ cliente_id: clienteId }, '-created_date', 50),
    enabled: !!clienteId
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
    mutationFn: (data) => base44.entities.TrocaVisita.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['trocasVisita']);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TrocaVisita.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['trocasVisita']);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TrocaVisita.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['trocasVisita']);
    }
  });

  const resetForm = () => {
    setFormData({
      produto_id: '',
      quantidade: '',
      data_validade: '',
      data_fabricacao: '',
      horario_fabricacao: '',
      motivo_troca: '',
      ja_informado_anteriormente: false,
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
    // Se tem produto, precisa de quantidade e motivo
    if (formData.produto_id) {
      if (!formData.quantidade || !formData.motivo_troca) {
        alert('Preencha os campos obrigatórios (Quantidade e Motivo)');
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
      motivo_troca: formData.motivo_troca || 'Foto Avulsa',
      ja_informado_anteriormente: formData.ja_informado_anteriormente,
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

  const handleEditSalvo = (troca) => {
    setFormData({
      produto_id: troca.produto_id,
      quantidade: troca.quantidade,
      data_validade: troca.data_validade || '',
      data_fabricacao: troca.data_fabricacao || '',
      horario_fabricacao: troca.horario_fabricacao || '',
      motivo_troca: troca.motivo_troca,
      ja_informado_anteriormente: troca.ja_informado_anteriormente || false,
      fotos_urls: troca.fotos_urls || (troca.foto_url ? [troca.foto_url] : [])
    });
    setEditingId(troca.id);
    setEditingLocalIndex(null);
  };

  const handleEditPendente = (item, index) => {
    setFormData({
      produto_id: item.produto_id,
      quantidade: item.quantidade,
      data_validade: item.data_validade || '',
      data_fabricacao: item.data_fabricacao || '',
      horario_fabricacao: item.horario_fabricacao || '',
      motivo_troca: item.motivo_troca,
      ja_informado_anteriormente: item.ja_informado_anteriormente || false,
      fotos_urls: item.fotos_urls || (item.foto_url ? [item.foto_url] : [])
    });
    setEditingLocalIndex(index);
    setEditingId(null);
  };

  const handleRemovePendente = (index) => {
    const novosItens = itensPendentes.filter((_, i) => i !== index);
    setItensPendentes(novosItens);
  };

  // Importar última troca do cliente
  const handleImportarUltimaTroca = () => {
    // Filtrar trocas que não são da visita atual
    const trocasAnteriores = ultimasTrocas.filter(t => t.visita_id !== visitaId);
    
    if (trocasAnteriores.length === 0) {
      alert('Não há trocas anteriores para este cliente');
      return;
    }

    // Pegar itens únicos por produto (última ocorrência de cada produto)
    const produtosImportados = new Map();
    trocasAnteriores.forEach(troca => {
      if (!produtosImportados.has(troca.produto_id)) {
        produtosImportados.set(troca.produto_id, troca);
      }
    });

    const novosItens = Array.from(produtosImportados.values()).map(troca => ({
      visita_id: visitaId,
      cliente_id: clienteId,
      cliente_nome: clienteNome,
      produto_id: troca.produto_id,
      produto_nome: troca.produto_nome,
      produto_codigo: troca.produto_codigo,
      quantidade: troca.quantidade,
      data_validade: '',
      data_fabricacao: '',
      horario_fabricacao: troca.horario_fabricacao || '',
      motivo_troca: troca.motivo_troca,
      ja_informado_anteriormente: false,
      foto_url: '',
      vendedor_id: vendedorAtual?.id || '',
      vendedor_nome: vendedorAtual?.nome || ''
    }));

    setItensPendentes(prev => [...prev, ...novosItens]);
    alert(`${novosItens.length} item(ns) importado(s) da última troca`);
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
        await base44.entities.TrocaVisita.create(item);
      }
      setItensPendentes([]);
      queryClient.invalidateQueries(['trocasVisita']);
      alert('Itens enviados com sucesso!');
    } catch (error) {
      alert('Erro ao enviar itens: ' + error.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card className="p-4 bg-slate-50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Adicionar Produtos em Troca</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={handleImportarUltimaTroca}
            className="text-orange-600 border-orange-300 hover:bg-orange-50"
          >
            <Download className="w-3 h-3 mr-1" />
            Importar Última Troca
          </Button>
        </div>

        <div className="space-y-3">
          {/* Seção de Fotos - Separada e Independente */}
          <div className="p-3 bg-white rounded-lg border border-slate-200">
            <Label className="text-xs font-medium">Fotos da Troca</Label>
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
              <Label className="text-xs">Data de Validade</Label>
              <Input
                type="date"
                value={formData.data_validade}
                onChange={(e) => handleDataValidadeChange(e.target.value)}
                className="h-9"
                disabled={!formData.produto_id}
              />
            </div>
            <div>
              <Label className="text-xs">Data de Fabricação</Label>
              <Input
                type="date"
                value={formData.data_fabricacao}
                onChange={(e) => setFormData({ ...formData, data_fabricacao: e.target.value })}
                className="h-9 bg-slate-100"
                disabled={!formData.produto_id}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Período de Fabricação</Label>
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

          <div>
            <Label className="text-xs">Motivo da Troca {formData.produto_id ? '*' : ''}</Label>
            <Select 
              value={formData.motivo_troca} 
              onValueChange={(v) => setFormData({ ...formData, motivo_troca: v })}
              disabled={!formData.produto_id}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione o motivo" />
              </SelectTrigger>
              <SelectContent>
                {motivos.map(m => (
                  <SelectItem key={m.id} value={m.descricao}>{m.descricao}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2 p-3 bg-amber-50 rounded border border-amber-200">
            <Checkbox
              id="ja-informado"
              checked={formData.ja_informado_anteriormente}
              onCheckedChange={(checked) => setFormData({ ...formData, ja_informado_anteriormente: checked })}
              disabled={!formData.produto_id}
            />
            <label htmlFor="ja-informado" className="text-xs font-medium text-amber-900 cursor-pointer">
              Esta troca já foi informada anteriormente (não realizada)
            </label>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || updateMutation.isPending}
            className="w-full bg-gradient-to-r from-red-500 to-orange-600 h-9"
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
                    <span>Motivo: {item.motivo_troca}</span>
                    {item.ja_informado_anteriormente && (
                      <span className="text-amber-600 font-medium">⚠️ Já informada</span>
                    )}
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
          Enviados ({trocas.length})
        </h4>
        {trocas.length === 0 ? (
          <Alert>
            <AlertDescription>Nenhuma troca enviada ainda</AlertDescription>
          </Alert>
        ) : (
          trocas.map((troca) => (
            <Card key={troca.id} className="p-3 bg-slate-100 border-slate-300">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-slate-500 text-white text-xs">Enviado</Badge>
                    <p className="font-medium text-sm text-slate-700">{troca.produto_nome}</p>
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500 mt-1">
                    <span>Qtd: {troca.quantidade}</span>
                    <span>Motivo: {troca.motivo_troca}</span>
                    {troca.ja_informado_anteriormente && (
                      <span className="text-amber-600 font-medium">⚠️ Já informada</span>
                    )}
                  </div>
                </div>
                {(troca.fotos_urls?.length > 0 || troca.foto_url) && (
                  <div className="flex gap-1 mr-2">
                    {(troca.fotos_urls || [troca.foto_url]).filter(Boolean).slice(0, 2).map((url, i) => (
                      <img key={i} src={url} alt={`Foto ${i+1}`} className="h-12 w-12 object-cover rounded" />
                    ))}
                    {(troca.fotos_urls?.length || 0) > 2 && (
                      <div className="h-12 w-12 bg-slate-200 rounded flex items-center justify-center text-xs font-medium">
                        +{troca.fotos_urls.length - 2}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEditSalvo(troca)} className="h-8 w-8">
                    <Edit className="w-3 h-3" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => deleteMutation.mutate(troca.id)}
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