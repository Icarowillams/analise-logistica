import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Users, CheckCircle, XCircle, Upload } from 'lucide-react';
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

export default function Funcionarios() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    nome: '', 
    cpf: '', 
    email: '', 
    funcao: '', 
    departamento_id: '',
    supervisor_id: '',
    telefone: '', 
    data_admissao: '', 
    status: 'ativo'
  });

  const queryClient = useQueryClient();

  const { data: funcionarios = [], isLoading } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: funcoes = [] } = useQuery({
    queryKey: ['funcoes'],
    queryFn: () => base44.entities.Funcao.list()
  });

  const { data: departamentos = [] } = useQuery({
    queryKey: ['departamentos'],
    queryFn: () => base44.entities.Departamento.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Vendedor.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['vendedores']);
      setFormOpen(false);
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Vendedor.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['vendedores']);
      setFormOpen(false);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Vendedor.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['vendedores']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ 
      nome: '', 
      cpf: '', 
      email: '', 
      funcao: '', 
      departamento_id: '',
      supervisor_id: '',
      telefone: '', 
      data_admissao: '', 
      status: 'ativo' 
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
      nome: item.nome || '',
      cpf: item.cpf || '',
      email: item.email || '',
      funcao: item.funcao || '',
      departamento_id: item.departamento_id || '',
      supervisor_id: item.supervisor_id || '',
      telefone: item.telefone || '',
      data_admissao: item.data_admissao || '',
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
      await base44.entities.Vendedor.create({
        ...item,
        status: item.status || 'ativo'
      });
    }
    queryClient.invalidateQueries(['vendedores']);
    setIsImporting(false);
    setBulkOpen(false);
  };

  const getSupervisorName = (id) => {
    if (!id) return '-';
    const supervisor = funcionarios.find(f => f.id === id);
    return supervisor ? supervisor.nome : '-';
  };

  const getDepartmentName = (id) => {
    if (!id) return '-';
    const dept = departamentos.find(d => d.id === id);
    return dept ? dept.nome : '-';
  };

  const bulkColumns = [
    { key: 'nome', label: 'Nome', required: true },
    { key: 'cpf', label: 'CPF' },
    { key: 'email', label: 'Email', required: true },
    { key: 'funcao', label: 'Função' },
    { key: 'departamento_id', label: 'ID Departamento' },
    { key: 'supervisor_id', label: 'ID Supervisor' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'data_admissao', label: 'Data Admissão' },
    { key: 'status', label: 'Status' }
  ];

  const bulkExampleData = [
    { nome: 'João Silva', cpf: '123.456.789-00', email: 'joao@empresa.com', funcao: 'Vendedor', supervisor_id: '', status: 'ativo' },
    { nome: 'Maria Santos', cpf: '987.654.321-00', email: 'maria@empresa.com', funcao: 'Gerente', supervisor_id: '', status: 'ativo' }
  ];

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'cpf', label: 'CPF' },
    { key: 'email', label: 'Email' },
    { key: 'funcao', label: 'Função' },
    { key: 'departamento_id', label: 'Departamento', render: (val) => getDepartmentName(val) },
    { 
      key: 'supervisor_id', 
      label: 'Supervisor',
      render: (val) => getSupervisorName(val)
    },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <Badge className={val === 'ativo' 
          ? 'bg-emerald-100 text-emerald-700 border-emerald-200' 
          : 'bg-slate-100 text-slate-600 border-slate-200'
        }>
          {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
          {val}
        </Badge>
      )
    }
  ];

  // Filter out current user from supervisor list to avoid self-reference loop (simple check)
  const potentialSupervisors = funcionarios.filter(f => f.id !== selected?.id);

  return (
    <div>
      <PageHeader 
        title="Funcionários" 
        subtitle="Gerencie sua equipe"
        icon={Users}
        action={handleNew}
        actionLabel="Novo Funcionário"
      />

      <div className="flex justify-end mb-4">
        <Button
          onClick={() => setBulkOpen(true)}
          variant="outline"
          className="border-amber-200 text-amber-700 hover:bg-amber-50"
        >
          <Upload className="w-4 h-4 mr-2" />
          Importar em Massa
        </Button>
      </div>

      <DataTable
        data={funcionarios}
        columns={columns}
        searchFields={['nome', 'email', 'cpf', 'funcao']}
        onEdit={handleEdit}
        onDelete={handleDelete}
        isLoading={isLoading}
      />

      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={selected ? 'Editar Funcionário' : 'Novo Funcionário'}
      >
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Nome *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>CPF</Label>
              <Input
                value={formData.cpf}
                onChange={(e) => setFormData({ ...formData, cpf: e.target.value })}
                placeholder="000.000.000-00"
              />
            </div>
            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Função</Label>
              <Select 
                value={formData.funcao} 
                onValueChange={(v) => setFormData({ ...formData, funcao: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a função..." />
                </SelectTrigger>
                <SelectContent>
                  {funcoes.map(f => (
                    <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Departamento</Label>
              <Select 
                value={formData.departamento_id} 
                onValueChange={(v) => setFormData({ ...formData, departamento_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o departamento..." />
                </SelectTrigger>
                <SelectContent>
                  {departamentos.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Supervisor</Label>
              <Select 
                value={formData.supervisor_id} 
                onValueChange={(v) => setFormData({ ...formData, supervisor_id: v === 'none' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um supervisor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {potentialSupervisors.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={formData.telefone}
                onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                placeholder="(00) 00000-0000"
              />
            </div>
            <div>
              <Label>Data de Admissão</Label>
              <Input
                type="date"
                value={formData.data_admissao}
                onChange={(e) => setFormData({ ...formData, data_admissao: e.target.value })}
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
              className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
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
        title="Importar Funcionários em Massa"
        description="Importe vários funcionários de uma vez usando CSV ou colando dados do Excel"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
    </div>
  );
}