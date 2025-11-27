import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Building2, CheckCircle, XCircle, Clock, Upload, Users, List, Save, Ban } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ClienteConsulta from '@/components/clientes/ClienteConsulta';

export default function Clientes() {
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    razao_social: '', nome_fantasia: '', cpf_cnpj: '', email: '', telefone: '',
    endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '',
    segmento_id: '', rede_id: '', vendedor_id: '', rota_id: '', plano_pagamento_id: '', tabela_id: '',
    data_primeiro_contato: '', status: 'ativo'
  });

  const queryClient = useQueryClient();

  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list()
  });

  const { data: redes = [] } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: planosPagamento = [] } = useQuery({
    queryKey: ['planosPagamento'],
    queryFn: () => base44.entities.PlanoPagamento.list()
  });

  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas'],
    queryFn: () => base44.entities.Rota.list()
  });

  const { data: tabelas = [] } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Cliente.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes']);
      resetForm();
      setIsEditing(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Cliente.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes']);
      resetForm();
      setIsEditing(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Cliente.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({
      razao_social: '', nome_fantasia: '', cpf_cnpj: '', email: '', telefone: '',
      endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '',
      segmento_id: '', rede_id: '', vendedor_id: '', rota_id: '', plano_pagamento_id: '', tabela_id: '',
      data_primeiro_contato: '', status: 'ativo'
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
      razao_social: item.razao_social || '',
      nome_fantasia: item.nome_fantasia || '',
      cpf_cnpj: item.cpf_cnpj || item.cnpj || '',
      email: item.email || '',
      telefone: item.telefone || '',
      endereco: item.endereco || '',
      numero: item.numero || '',
      bairro: item.bairro || '',
      cidade: item.cidade || '',
      estado: item.estado || '',
      cep: item.cep || '',
      segmento_id: item.segmento_id || '',
      rede_id: item.rede_id || '',
      vendedor_id: item.vendedor_id || '',
      rota_id: item.rota_id || '',
      plano_pagamento_id: item.plano_pagamento_id || '',
      tabela_id: item.tabela_id || '',
      data_primeiro_contato: item.data_primeiro_contato || '',
      status: item.status || 'ativo'
    });
    setIsEditing(true);
    setActiveTab("cadastro");
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
    if (selected) {
      updateMutation.mutate({ id: selected.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleBulkImport = async (data) => {
    setIsImporting(true);
    for (const item of data) {
      await base44.entities.Cliente.create({
        ...item,
        status: item.status || 'ativo'
      });
    }
    queryClient.invalidateQueries(['clientes']);
    setIsImporting(false);
    setBulkOpen(false);
  };

  const bulkColumns = [
    { key: 'razao_social', label: 'Razão Social', required: true },
    { key: 'nome_fantasia', label: 'Nome Fantasia' },
    { key: 'cpf_cnpj', label: 'CPF/CNPJ' },
    { key: 'plano_pagamento_id', label: 'ID Plano Pag.' },
    { key: 'tabela_id', label: 'ID Tabela Preço' },
    { key: 'segmento_id', label: 'ID Segmento' },
    { key: 'rede_id', label: 'ID Rede' },
    { key: 'vendedor_id', label: 'ID Vendedor' },
    { key: 'rota_id', label: 'ID Rota' },
    { key: 'email', label: 'Email' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'endereco', label: 'Endereço' },
    { key: 'numero', label: 'Número' },
    { key: 'bairro', label: 'Bairro' },
    { key: 'cidade', label: 'Cidade' },
    { key: 'estado', label: 'Estado' },
    { key: 'cep', label: 'CEP' },
    { key: 'status', label: 'Status' }
  ];

  const bulkExampleData = [
    { razao_social: 'Empresa ABC Ltda', nome_fantasia: 'ABC Store', cpf_cnpj: '12.345.678/0001-90', email: 'contato@abc.com', telefone: '(11) 99999-0000', cidade: 'São Paulo', estado: 'SP', status: 'ativo' },
    { razao_social: 'Comércio XYZ', nome_fantasia: 'XYZ Shop', cpf_cnpj: '98.765.432/0001-10', email: 'contato@xyz.com', telefone: '(11) 88888-0000', cidade: 'Campinas', estado: 'SP', status: 'ativo' }
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Building2 className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Clientes</h1>
            <p className="text-neutral-500 mt-0.5">Gestão de base de clientes</p>
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
            Novo Cliente
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
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
                {selected ? 'Editar Cliente' : 'Novo Cliente'}
              </h2>
              {!isEditing && (
                <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
                  Modo Visualização
                </Badge>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <Label>Razão Social *</Label>
                  <Input
                    value={formData.razao_social}
                    onChange={(e) => setFormData({ ...formData, razao_social: e.target.value })}
                    required
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Nome Fantasia</Label>
                  <Input
                    value={formData.nome_fantasia}
                    onChange={(e) => setFormData({ ...formData, nome_fantasia: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>CPF/CNPJ</Label>
                  <Input
                    value={formData.cpf_cnpj}
                    onChange={(e) => setFormData({ ...formData, cpf_cnpj: e.target.value })}
                    placeholder="CPF ou CNPJ"
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Plano de Pagamento</Label>
                  <Select 
                    value={formData.plano_pagamento_id} 
                    onValueChange={(v) => setFormData({ ...formData, plano_pagamento_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {planosPagamento.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tabela de Preço</Label>
                  <Select 
                    value={formData.tabela_id} 
                    onValueChange={(v) => setFormData({ ...formData, tabela_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {tabelas.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Segmento</Label>
                  <Select 
                    value={formData.segmento_id} 
                    onValueChange={(v) => setFormData({ ...formData, segmento_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {segmentos.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Rede/Franquia</Label>
                  <Select 
                    value={formData.rede_id} 
                    onValueChange={(v) => setFormData({ ...formData, rede_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {redes.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Vendedor</Label>
                  <Select 
                    value={formData.vendedor_id} 
                    onValueChange={(v) => setFormData({ ...formData, vendedor_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {vendedores.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Rota</Label>
                  <Select 
                    value={formData.rota_id} 
                    onValueChange={(v) => setFormData({ ...formData, rota_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {rotas.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input
                    value={formData.telefone}
                    onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Endereço</Label>
                  <Textarea
                    value={formData.endereco}
                    onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                    rows={2}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Número</Label>
                  <Input
                    value={formData.numero}
                    onChange={(e) => setFormData({ ...formData, numero: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Bairro</Label>
                  <Input
                    value={formData.bairro}
                    onChange={(e) => setFormData({ ...formData, bairro: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Cidade</Label>
                  <Input
                    value={formData.cidade}
                    onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Estado (UF)</Label>
                  <Input
                    value={formData.estado}
                    onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
                    placeholder="UF"
                    maxLength={2}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>CEP</Label>
                  <Input
                    value={formData.cep}
                    onChange={(e) => setFormData({ ...formData, cep: e.target.value })}
                    placeholder="00000-000"
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Data Primeiro Contato</Label>
                  <Input
                    type="date"
                    value={formData.data_primeiro_contato}
                    onChange={(e) => setFormData({ ...formData, data_primeiro_contato: e.target.value })}
                    disabled={!isEditing}
                  />
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
                      <SelectItem value="prospecto">Prospecto</SelectItem>
                    </SelectContent>
                  </Select>
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
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
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
          <ClienteConsulta onEdit={handleEdit} onDelete={handleDelete} />
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
        title="Importar Clientes em Massa"
        description="Importe vários clientes de uma vez usando CSV ou colando dados do Excel"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
    </div>
  );
}