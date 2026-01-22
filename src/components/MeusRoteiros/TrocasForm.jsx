import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Plus, Edit, Trash2, Send, CheckCircle } from 'lucide-react';
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
    foto_url: ''
  });
  const [editingId, setEditingId] = useState(null);
  const [editingLocalIndex, setEditingLocalIndex] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [itensPendentes, setItensPendentes] = useState([]); // Itens não enviados ainda
  const [enviando, setEnviando] = useState(false);

  const queryClient = useQueryClient();

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: motivos = [] } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
  });

  const { data: trocas = [] } = useQuery({
    queryKey: ['trocasVisita', visitaId],
    queryFn: () => base44.entities.TrocaVisita.filter({ visita_id: visitaId })
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
      foto_url: ''
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
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData({ ...formData, foto_url: file_url });
    } catch (error) {
      alert('Erro ao fazer upload da foto');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = () => {
    if (!formData.produto_id || !formData.quantidade || !formData.motivo_troca) {
      alert('Preencha os campos obrigatórios');
      return;
    }

    const produto = produtos.find(p => p.id === formData.produto_id);
    
    const data = {
      visita_id: visitaId,
      cliente_id: clienteId,
      cliente_nome: clienteNome,
      produto_id: formData.produto_id,
      produto_nome: produto?.nome || '',
      produto_codigo: produto?.codigo || '',
      quantidade: parseFloat(formData.quantidade),
      data_validade: formData.data_validade || null,
      data_fabricacao: formData.data_fabricacao || null,
      horario_fabricacao: formData.horario_fabricacao || null,
      motivo_troca: formData.motivo_troca,
      ja_informado_anteriormente: formData.ja_informado_anteriormente,
      foto_url: formData.foto_url || null,
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
      foto_url: troca.foto_url || ''
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
      foto_url: item.foto_url || ''
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
        <h3 className="font-semibold mb-4">Adicionar Produtos em Troca</h3>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Produto *</Label>
              <Select value={formData.produto_id} onValueChange={(v) => setFormData({ ...formData, produto_id: v })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  {produtos.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Quantidade *</Label>
              <Input
                type="number"
                value={formData.quantidade}
                onChange={(e) => setFormData({ ...formData, quantidade: e.target.value })}
                placeholder="0"
                className="h-9"
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
              />
            </div>
            <div>
              <Label className="text-xs">Data de Fabricação</Label>
              <Input
                type="date"
                value={formData.data_fabricacao}
                onChange={(e) => setFormData({ ...formData, data_fabricacao: e.target.value })}
                className="h-9 bg-slate-100"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Horário de Fabricação</Label>
            <Input
              type="time"
              value={formData.horario_fabricacao}
              onChange={(e) => setFormData({ ...formData, horario_fabricacao: e.target.value })}
              className="h-9"
            />
          </div>

          <div>
            <Label className="text-xs">Motivo da Troca *</Label>
            <Select value={formData.motivo_troca} onValueChange={(v) => setFormData({ ...formData, motivo_troca: v })}>
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
            />
            <label htmlFor="ja-informado" className="text-xs font-medium text-amber-900 cursor-pointer">
              Esta troca já foi informada anteriormente (não realizada)
            </label>
          </div>

          <div>
            <Label className="text-xs">Foto da Troca</Label>
            <div className="flex gap-2">
              <Input
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="h-9"
                disabled={uploadingPhoto}
              />
              {formData.foto_url && (
                <img src={formData.foto_url} alt="Preview" className="h-9 w-9 object-cover rounded" />
              )}
            </div>
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
                {item.foto_url && (
                  <img src={item.foto_url} alt="Troca" className="h-12 w-12 object-cover rounded mr-2" />
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
                {troca.foto_url && (
                  <img src={troca.foto_url} alt="Troca" className="h-12 w-12 object-cover rounded mr-2" />
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