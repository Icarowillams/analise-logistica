import React, { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Send, CheckCircle, Camera, Image as ImageIcon, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function TrocasForm({ visitaId, clienteId, clienteNome }) {
  const [formData, setFormData] = useState({
    produto_id: '', quantidade: '', data_validade: '', data_fabricacao: '',
    horario_fabricacao: '', motivo_troca: '', ja_informado_anteriormente: false, fotos_urls: []
  });
  const [itensPendentes, setItensPendentes] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });
  const { data: subCategorias = [] } = useQuery({ queryKey: ['subCategorias'], queryFn: () => base44.entities.SubCategoria.list() });
  const { data: motivos = [] } = useQuery({ queryKey: ['motivosTroca'], queryFn: () => base44.entities.MotivoTroca.list() });
  const { data: trocas = [] } = useQuery({
    queryKey: ['trocasVisita', visitaId],
    queryFn: () => base44.entities.TrocaVisita.filter({ visita_id: visitaId }),
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

  const produtosPorSubcategoria = useMemo(() => {
    const grupos = {}; const semCategoria = [];
    produtos.forEach(p => {
      if (p.sub_categoria_id) {
        if (!grupos[p.sub_categoria_id]) grupos[p.sub_categoria_id] = [];
        grupos[p.sub_categoria_id].push(p);
      } else semCategoria.push(p);
    });
    Object.keys(grupos).forEach(key => grupos[key].sort((a, b) => (a.nome || '').localeCompare(b.nome || '')));
    semCategoria.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    return { grupos, semCategoria };
  }, [produtos]);

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TrocaVisita.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['trocasVisita'])
  });

  const resetForm = () => setFormData({
    produto_id: '', quantidade: '', data_validade: '', data_fabricacao: '',
    horario_fabricacao: '', motivo_troca: '', ja_informado_anteriormente: false, fotos_urls: []
  });

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
    if (!formData.produto_id || !formData.quantidade || !formData.motivo_troca) {
      alert('Preencha produto, quantidade e motivo'); return;
    }
    const produto = produtos.find(p => p.id === formData.produto_id);
    const data = {
      visita_id: visitaId, cliente_id: clienteId, cliente_nome: clienteNome,
      produto_id: formData.produto_id,
      produto_nome: produto?.nome || '',
      produto_codigo: produto?.codigo || '',
      quantidade: parseFloat(formData.quantidade),
      data_validade: formData.data_validade || null,
      data_fabricacao: formData.data_fabricacao || null,
      horario_fabricacao: formData.horario_fabricacao || null,
      motivo_troca: formData.motivo_troca,
      ja_informado_anteriormente: formData.ja_informado_anteriormente,
      foto_url: formData.fotos_urls[0] || null,
      fotos_urls: formData.fotos_urls,
      vendedor_id: vendedorAtual?.id || '',
      vendedor_nome: vendedorAtual?.nome || ''
    };
    setItensPendentes([...itensPendentes, data]);
    resetForm();
  };

  const handleEnviar = async () => {
    if (itensPendentes.length === 0) return;
    setEnviando(true);
    try {
      for (const item of itensPendentes) await base44.entities.TrocaVisita.create(item);
      setItensPendentes([]);
      queryClient.invalidateQueries(['trocasVisita']);
      alert('Trocas enviadas!');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card className="p-4 bg-slate-50">
        <h3 className="font-semibold mb-4">Registrar Troca</h3>
        <div className="space-y-3">
          <div className="p-3 bg-white rounded-lg border border-slate-200">
            <Label className="text-xs font-medium">Fotos da Troca</Label>
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
              <Label className="text-xs">Produto *</Label>
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
              <Label className="text-xs">Quantidade *</Label>
              <Input type="number" value={formData.quantidade} onChange={(e) => setFormData({ ...formData, quantidade: e.target.value })} className="h-9" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Validade</Label>
              <Input type="date" value={formData.data_validade} onChange={(e) => setFormData({ ...formData, data_validade: e.target.value })} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Fabricação</Label>
              <Input type="date" value={formData.data_fabricacao} onChange={(e) => setFormData({ ...formData, data_fabricacao: e.target.value })} className="h-9" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Motivo da Troca *</Label>
            <Select value={formData.motivo_troca} onValueChange={(v) => setFormData({ ...formData, motivo_troca: v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {motivos.map(m => <SelectItem key={m.id} value={m.descricao || m.nome || m.id}>{m.descricao || m.nome}</SelectItem>)}
                {motivos.length === 0 && <>
                  <SelectItem value="vencido">Vencido</SelectItem>
                  <SelectItem value="avaria">Avaria</SelectItem>
                  <SelectItem value="proximo_vencimento">Próximo do vencimento</SelectItem>
                </>}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox id="ja-informado" checked={formData.ja_informado_anteriormente} onCheckedChange={(v) => setFormData({ ...formData, ja_informado_anteriormente: v })} />
            <label htmlFor="ja-informado" className="text-xs cursor-pointer">Já informado anteriormente</label>
          </div>

          <Button onClick={handleSubmit} className="w-full bg-gradient-to-r from-red-500 to-rose-600 h-9">
            <Plus className="w-4 h-4 mr-2" />Adicionar à Lista
          </Button>
        </div>
      </Card>

      {itensPendentes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Pendentes ({itensPendentes.length})</h4>
            <Button onClick={handleEnviar} disabled={enviando} size="sm" className="bg-blue-600 text-white">
              <Send className="w-3 h-3 mr-1" />{enviando ? 'Enviando...' : 'Enviar'}
            </Button>
          </div>
          {itensPendentes.map((item, index) => (
            <Card key={index} className="p-3 border-2 border-dashed border-red-300 bg-red-50">
              <p className="font-medium text-sm">{item.produto_nome}</p>
              <p className="text-xs text-slate-500">Qtd: {item.quantidade} • {item.motivo_troca}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-600" />Enviados ({trocas.length})
        </h4>
        {trocas.length === 0 ? (
          <Alert><AlertDescription>Nenhuma troca registrada</AlertDescription></Alert>
        ) : (
          trocas.map((troca) => (
            <Card key={troca.id} className="p-3 bg-slate-100 flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{troca.produto_nome}</p>
                <p className="text-xs text-slate-500">Qtd: {troca.quantidade} • {troca.motivo_troca}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(troca.id)} className="text-red-500 h-8 w-8">
                <Trash2 className="w-3 h-3" />
              </Button>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}