import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Plus, Edit, Trash2, Download, Upload, Camera } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function EstoqueForm({ visitaId, clienteId, clienteNome }) {
  const [formData, setFormData] = useState({
    produto_id: '',
    quantidade: '',
    data_validade: '',
    data_fabricacao: '',
    horario_fabricacao: '',
    foto_url: ''
  });
  const [editingId, setEditingId] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const queryClient = useQueryClient();

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

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
      resetForm();
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
      foto_url: ''
    });
    setEditingId(null);
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
    if (!formData.produto_id || !formData.quantidade) {
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
      foto_url: formData.foto_url || null,
      vendedor_id: vendedorAtual?.id || '',
      vendedor_nome: vendedorAtual?.nome || ''
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (estoque) => {
    setFormData({
      produto_id: estoque.produto_id,
      quantidade: estoque.quantidade,
      data_validade: estoque.data_validade || '',
      data_fabricacao: estoque.data_fabricacao || '',
      horario_fabricacao: estoque.horario_fabricacao || '',
      foto_url: estoque.foto_url || ''
    });
    setEditingId(estoque.id);
  };

  const handleImportarUltimoEstoque = async () => {
    try {
      const todasVisitas = await base44.entities.VisitaRoteiro.filter({ 
        cliente_id: clienteId,
        status: 'concluida'
      });
      
      if (todasVisitas.length === 0) {
        alert('Este cliente não possui estoque informado anteriormente.');
        return;
      }

      const visitasOrdenadas = todasVisitas.sort((a, b) => 
        new Date(b.checkout_time) - new Date(a.checkout_time)
      );
      
      const ultimaVisita = visitasOrdenadas[0];
      const estoquesAnteriores = await base44.entities.EstoqueVisita.filter({ 
        visita_id: ultimaVisita.id 
      });

      if (estoquesAnteriores.length === 0) {
        alert('Este cliente não possui estoque informado anteriormente.');
        return;
      }

      for (const estoque of estoquesAnteriores) {
        const data = {
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
          foto_url: estoque.foto_url,
          vendedor_id: vendedorAtual?.id || '',
          vendedor_nome: vendedorAtual?.nome || ''
        };
        await base44.entities.EstoqueVisita.create(data);
      }

      queryClient.invalidateQueries(['estoquesVisita']);
      alert('Último estoque importado com sucesso!');
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
              <Label className="text-xs">Data de Validade *</Label>
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
                placeholder="Calculado automaticamente"
              />
              <p className="text-xs text-slate-500 mt-1">Calculado: 25 dias antes da validade</p>
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
            <Label className="text-xs">Foto do Estoque</Label>
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
            className="w-full bg-gradient-to-r from-amber-500 to-orange-600 h-9"
          >
            <Plus className="w-4 h-4 mr-2" />
            {editingId ? 'Atualizar na Lista' : 'Adicionar à Lista'}
          </Button>
        </div>
      </Card>

      <div className="space-y-2">
        <h4 className="font-semibold text-sm">Produtos Adicionados ({estoques.length})</h4>
        {estoques.length === 0 ? (
          <Alert>
            <AlertDescription>Nenhum produto adicionado ainda</AlertDescription>
          </Alert>
        ) : (
          estoques.map((estoque) => (
            <Card key={estoque.id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-medium text-sm">{estoque.produto_nome}</p>
                  <div className="flex gap-3 text-xs text-slate-500 mt-1">
                    <span>Qtd: {estoque.quantidade}</span>
                    {estoque.data_validade && <span>Val: {new Date(estoque.data_validade).toLocaleDateString('pt-BR')}</span>}
                    {estoque.horario_fabricacao && <span>Hora: {estoque.horario_fabricacao}</span>}
                  </div>
                </div>
                {estoque.foto_url && (
                  <img src={estoque.foto_url} alt="Produto" className="h-12 w-12 object-cover rounded mr-2" />
                )}
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(estoque)} className="h-8 w-8">
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