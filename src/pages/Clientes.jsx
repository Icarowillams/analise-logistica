import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Building2, CheckCircle, XCircle, Clock, Upload } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';

export default function Clientes() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    razao_social: '', nome_fantasia: '', cpf_cnpj: '', email: '', telefone: '',
    endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '',
    segmento_id: '', rede_id: '', vendedor_id: '', rota_id: '', plano_pagamento_id: '',
    data_primeiro_contato: '', status: 'ativo'
  });

  const queryClient = useQueryClient();

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

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

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Cliente.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes']);
      setFormOpen(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Cliente.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes']);
      setFormOpen(false);
      resetForm();
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
      segmento_id: '', rede_id: '', vendedor_id: '', rota_id: '', plano_pagamento_id: '',
      data_primeiro_contato: '', status: 'ativo'
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
      data_primeiro_contato: item.data_primeiro_contato || '',
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

  const getStatusBadge = (status) => {
    const styles = {
      ativo: { class: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle },
      inativo: { class: 'bg-slate-100 text-slate-600 border-slate-200', icon: XCircle },
      prospecto: { class: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock }
    };
    const s = styles[status] || styles.ativo;
    return (
      <Badge className={s.class}>
        <s.icon className="w-3 h-3 mr-1" />
        {status}
      </Badge>
    );
  };

  const getName = (list, id) => {
    if (!id) return '-';
    const item = list.find(i => i.id === id);
    return item ? item.nome : '-';
  };

  const getVendedorAndSupervisor = (vendedorId) => {
    if (!vendedorId) return { vendedor: '-', supervisor: '-' };
    const vendedor = vendedores.find(v => v.id === vendedorId);
    if (!vendedor) return { vendedor: '-', supervisor: '-' };
    
    const supervisor = vendedores.find(s => s.id === vendedor.supervisor_id);
    return {
      vendedor: vendedor.nome,
      supervisor: supervisor ? supervisor.nome : '-'
    };
  };

  const columns = [
    { key: 'razao_social', label: 'Razão Social', sortable: true },
    { key: 'nome_fantasia', label: 'Nome Fantasia' },
    { key: 'cpf_cnpj', label: 'CPF/CNPJ', render: (val, item) => val || item.cnpj || '-' },
    { key: 'plano_pagamento_id', label: 'Plano Pag.', render: (val) => getName(planosPagamento, val) },
    { key: 'segmento_id', label: 'Segmento', render: (val) => getName(segmentos, val) },
    { key: 'rede_id', label: 'Rede', render: (val) => getName(redes, val) },
    { 
      key: 'vendedor_id', 
      label: 'Vendedor', 
      render: (val) => getVendedorAndSupervisor(val).vendedor
    },
    { 
      key: 'supervisor_id', 
      label: 'Supervisor', 
      render: (_, item) => getVendedorAndSupervisor(item.vendedor_id).supervisor
    },
    { key: 'cidade', label: 'Cidade' },
    { key: 'bairro', label: 'Bairro' },
    { key: 'estado', label: 'UF' },
    { key: 'endereco', label: 'Endereço' },
    { key: 'numero', label: 'Número' },
    { key: 'rota_id', label: 'Rota', render: (val) => getName(rotas, val) },
    { key: 'telefone', label: 'Telefone' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => getStatusBadge(val)
    }
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Clientes</h1>
            <p className="text-slate-500 mt-0.5">Base de clientes cadastrados</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setBulkOpen(true)}
            variant="outline"
            className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
          >
            <Upload className="w-4 h-4 mr-2" />
            Importar em Massa
          </Button>
          <Button
            onClick={handleNew}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/30"
          >
            Novo Cliente
          </Button>
        </div>
      </div>

      <DataTable
        data={clientes}
        columns={columns}
        searchFields={['razao_social', 'nome_fantasia', 'cnpj', 'cidade']}
        onEdit={handleEdit}
        onDelete={handleDelete}
        isLoading={isLoading}
      />

      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={selected ? 'Editar Cliente' : 'Novo Cliente'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Razão Social *</Label>
              <Input
                value={formData.razao_social}
                onChange={(e) => setFormData({ ...formData, razao_social: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Nome Fantasia</Label>
              <Input
                value={formData.nome_fantasia}
                onChange={(e) => setFormData({ ...formData, nome_fantasia: e.target.value })}
              />
            </div>
            <div>
              <Label>CNPJ</Label>
              <Input
                value={formData.cnpj}
                onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={formData.telefone}
                onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Endereço</Label>
              <Textarea
                value={formData.endereco}
                onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                rows={2}
              />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input
                value={formData.cidade}
                onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
              />
            </div>
            <div>
              <Label>Estado</Label>
              <Input
                value={formData.estado}
                onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
                placeholder="UF"
                maxLength={2}
              />
            </div>
            <div>
              <Label>CEP</Label>
              <Input
                value={formData.cep}
                onChange={(e) => setFormData({ ...formData, cep: e.target.value })}
                placeholder="00000-000"
              />
            </div>
            <div>
              <Label>Segmento</Label>
              <Select value={formData.segmento_id} onValueChange={(v) => setFormData({ ...formData, segmento_id: v })}>
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
              <Select value={formData.rede_id} onValueChange={(v) => setFormData({ ...formData, rede_id: v })}>
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
              <Label>Data Primeiro Contato</Label>
              <Input
                type="date"
                value={formData.data_primeiro_contato}
                onChange={(e) => setFormData({ ...formData, data_primeiro_contato: e.target.value })}
              />
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
                  <SelectItem value="prospecto">Prospecto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
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