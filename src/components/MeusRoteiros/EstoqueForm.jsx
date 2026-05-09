import React, { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, Send, CheckCircle, Camera, Image as ImageIcon, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function EstoqueForm({ visitaId, clienteId, clienteNome }) {
  const [formData, setFormData] = useState({
    produto_id: '', quantidade: '', data_validade: '', data_fabricacao: '', horario_fabricacao: '', fotos_urls: []
  });
  const [editingId, setEditingId] = useState(null);
  const [editingLocalIndex, setEditingLocalIndex] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [itensPendentes, setItensPendentes] = useState([]);
  const [enviando, setEnviando] = useState(false);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });
  const { data: subCategorias = [] } = useQuery({ queryKey: ['subCategorias'], queryFn: () => base44.entities.SubCategoria.list() });
  const { data: clienteData } = useQuery({
    queryKey: ['cliente-tabela', clienteId],
    queryFn: () => base44.entities.Cliente.filter({ id: clienteId }),
    enabled: !!clienteId
  });
  const tabelaIdCliente = clienteData?.[0]?.tabela_id || '';

  const { data: precosTabela = [] } = useQuery({
    queryKey: ['precosProduto-estoque', tabelaIdCliente],
    queryFn: () => tabelaIdCliente ? base44.entities.PrecoProduto.filter({ tabela_id: tabelaIdCliente }) : [],
    enabled: !!tabelaIdCliente
  });

  const produtosFiltrados = useMemo(() => {
    if (!tabelaIdCliente || precosTabela.length === 0) return produtos;
    const idsComPreco = new Set(precosTabela.filter(p => p.valor_unitario > 0 || (p.ativacao_acao && p.valor_acao > 0)).map(p => p.produto_id));
    return produtos.filter(p => idsComPreco.has(p.id));
  }, [produtos, precosTabela, tabelaIdCliente]);

  const produtosPorSubcategoria = useMemo(() => {
    const grupos = {}; const semCategoria = [];
    produtosFiltrados.forEach(p => {
      if (p.sub_categoria_id) {
        if (!grupos[p.sub_categoria_id]) grupos[p.sub_categoria_id] = [];
        grupos[p.sub_categoria_id].push(p);
      } else semCategoria.push(p);
    });
    Object.keys(grupos).forEach(key => grupos[key].sort((a, b) => (a.nome || '').localeCompare(b.nome || '')));
    semCategoria.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    return { grupos, semCategoria };
  }, [produtosFiltrados]);

  const { data: estoques = [] } = useQuery({
    queryKey: ['estoquesVisita', visitaId],
    queryFn: () => base44.entities.EstoqueVisita.filter({ visita_id: visitaId }),
    enabled: !!visitaId
  });

  const { data: vendedorAtual } = useQuery({
    queryKey: ['vendedorAtual'],
    queryFn: async () => {
      const user = await base44.auth.me();
      const vendedores = await base44.entities.Vendedor.list();
      return vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.EstoqueVisita.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['estoquesVisita']); resetForm(); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.EstoqueVisita.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['estoquesVisita'])
  });

  const resetForm = () => {
    setFormData({ produto_id: '', quantidade: '', data_validade: '', data_fabricacao: '', horario_fabricacao: '', fotos_urls: [] });
    setEditingId(null); setEditingLocalIndex(null);
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
      setFormData(prev => ({ ...prev, fotos_urls: [...prev.fotos_urls, ...newUrls] }));
    } catch (error) {
      alert('Erro ao fazer upload da foto');
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = (index) => {
    setFormData({ ...formData, fotos_urls: formData.fotos_urls.filter((_, i) => i !== index) });
  };

  const handleSubmit = () => {
    if (formData.produto_id) {
      if (!formData.quantidade || !formData.data_fabricacao || !formData.horario_fabricacao) {
        alert('Preencha campos obrigatórios'); return;
      }
    }
    if (!formData.produto_id && formData.fotos_urls.length === 0) {
      alert('Adicione produto ou foto'); return;
    }

    const produto = formData.produto_id ? produtos.find(p => p.id === formData.produto_id) : null;
    const data = {
      visita_id: visitaId, cliente_id: clienteId, cliente_nome: clienteNome,
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

    if (editingId) updateMutation.mutate({ id: editingId, data });
    else if (editingLocalIndex !== null) {
      const novosItens = [...itensPendentes];
      novosItens[editingLocalIndex] = data;
      setItensPendentes(novosItens);
      resetForm();
    } else {
      setItensPendentes([...itensPendentes, data]);
      resetForm();
    }
  };

  const handleEnviarSemFinalizar = async () => {
    if (itensPendentes.length === 0) return;
    setEnviando(true);
    try {
      for (const item of itensPendentes) await base44.entities.EstoqueVisita.create(item);
      setItensPendentes([]);
      queryClient.invalidateQueries(['estoquesVisita']);
      alert('Itens enviados!');
    } catch (error) {
      alert('Erro: ' + error.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card className="p-4 bg-slate-50">
        <h3 className="font-semibold mb-4">Adicionar Produtos ao Estoque</h3>
        <div className="space-y-3">
          <div className="p-3 bg-white rounded-lg border border-slate-200">
            <Label className="text-xs font-medium">Fotos do Estoque</Label>
            <div className="space-y-2 mt-2">
              <div className="flex gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} className="hidden" />
                <Button type="button" variant="outline" size="sm" onClick={() => cameraInputRef.current?.click()} className="flex-1" disabled={uploadingPhoto}>
                  <Camera className="w-4 h-4 mr-1" />Câmera
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="flex-1" disabled={uploadingPhoto}>
                  <ImageIcon className="w-4 h-4 mr-1" />Galeria
                </Button>
              </div>
              {formData.fotos_urls.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.fotos_urls.map((url, index) => (
                    <div key={index} className="relative">
                      <img src={url} className="h-16 w-16 object-cover rounded border" alt="" />
                      <button onClick={() => handleRemovePhoto(index)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Produto</Label>
              <Select value={formData.produto_id} onValueChange={(v) => setFormData({ ...formData, produto_id: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent className="max-h-80">
                  {produtosPorSubcategoria.semCategoria.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs">Sem Categoria</SelectLabel>
                      {produtosPorSubcategoria.semCategoria.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectGroup>
                  )}
                  {Object.entries(produtosPorSubcategoria.grupos).map(([subCatId, prods]) => {
                    const subCat = subCategorias.find(s => s.id === subCatId);
                    return (
                      <SelectGroup key={subCatId}>
                        <SelectLabel className="text-xs font-semibold text-amber-600">{subCat?.nome || 'Outros'}</SelectLabel>
                        {prods.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Quantidade {formData.produto_id ? '*' : ''}</Label>
              <Input type="number" value={formData.quantidade} onChange={(e) => setFormData({ ...formData, quantidade: e.target.value })} className="h-9" disabled={!formData.produto_id} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data de Validade *</Label>
              <Input type="date" value={formData.data_validade} onChange={(e) => handleDataValidadeChange(e.target.value)} className="h-9" disabled={!formData.produto_id} />
            </div>
            <div>
              <Label className="text-xs">Data de Fabricação *</Label>
              <Input type="date" value={formData.data_fabricacao} onChange={(e) => setFormData({ ...formData, data_fabricacao: e.target.value })} className="h-9 bg-slate-100" disabled={!formData.produto_id} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Período de Fabricação *</Label>
            <Select value={formData.horario_fabricacao} onValueChange={(v) => setFormData({ ...formData, horario_fabricacao: v })} disabled={!formData.produto_id}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="madrugada">Madrugada (00h - 06h)</SelectItem>
                <SelectItem value="manha">Manhã (06h - 12h)</SelectItem>
                <SelectItem value="tarde">Tarde (12h - 18h)</SelectItem>
                <SelectItem value="noite">Noite (18h - 00h)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSubmit} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 h-9">
            <Plus className="w-4 h-4 mr-2" />
            {editingId ? 'Atualizar Salvo' : editingLocalIndex !== null ? 'Atualizar Pendente' : 'Adicionar à Lista'}
          </Button>
        </div>
      </Card>

      {itensPendentes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Pendentes ({itensPendentes.length})</h4>
            <Button onClick={handleEnviarSemFinalizar} disabled={enviando} size="sm" className="bg-blue-600 text-white">
              <Send className="w-3 h-3 mr-1" />{enviando ? 'Enviando...' : 'Enviar'}
            </Button>
          </div>
          {itensPendentes.map((item, index) => (
            <Card key={index} className="p-3 border-2 border-dashed border-amber-300 bg-amber-50">
              <p className="font-medium text-sm">{item.produto_nome}</p>
              <p className="text-xs text-slate-500">Qtd: {item.quantidade}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-600" />Enviados ({estoques.length})
        </h4>
        {estoques.length === 0 ? (
          <Alert><AlertDescription>Nenhum item enviado</AlertDescription></Alert>
        ) : (
          estoques.map((estoque) => (
            <Card key={estoque.id} className="p-3 bg-slate-100 flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{estoque.produto_nome}</p>
                <p className="text-xs text-slate-500">Qtd: {estoque.quantidade}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(estoque.id)} className="text-red-500 h-8 w-8">
                <Trash2 className="w-3 h-3" />
              </Button>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}