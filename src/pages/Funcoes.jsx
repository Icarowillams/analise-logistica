import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Briefcase, CheckCircle, XCircle, Building2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Funcoes() {
  const [activeTab, setActiveTab] = useState("funcoes");

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Funções e Departamentos" 
        subtitle="Gerencie cargos, funções e departamentos"
        icon={Briefcase}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="funcoes" className="flex items-center gap-2">
            <Briefcase className="w-4 h-4" />
            Funções
          </TabsTrigger>
          <TabsTrigger value="departamentos" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Departamentos
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="funcoes" className="animate-in fade-in-50 duration-300">
          <GerenciarFuncoes />
        </TabsContent>
        
        <TabsContent value="departamentos" className="animate-in fade-in-50 duration-300">
          <GerenciarDepartamentos />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GerenciarFuncoes() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', descricao: '', status: 'ativo' });

  const queryClient = useQueryClient();

  const { data: funcoes = [], isLoading } = useQuery({
    queryKey: ['funcoes'],
    queryFn: () => base44.entities.Funcao.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Funcao.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['funcoes']);
      setFormOpen(false);
      resetForm();
      toast.success('✅ Função criada com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar função: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Funcao.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['funcoes']);
      setFormOpen(false);
      resetForm();
      toast.success('✅ Função atualizada com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar função: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Funcao.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['funcoes']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ nome: '', descricao: '', status: 'ativo' });
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
      descricao: item.descricao || '',
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

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'descricao', label: 'Descrição' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
          {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
          {val}
        </Badge>
      )
    }
  ];

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button 
          onClick={handleNew}
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30"
        >
          Nova Função
        </Button>
      </div>

      <DataTable
        data={funcoes}
        columns={columns}
        searchFields={['nome', 'descricao']}
        onEdit={handleEdit}
        onDelete={handleDelete}
        pageSize={1000}
        isLoading={isLoading}
      />

      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={selected ? 'Editar Função' : 'Nova Função'}
      >
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <Label>Nome da Função *</Label>
            <Input
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              value={formData.descricao}
              onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
              rows={3}
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
    </div>
  );
}

function GerenciarDepartamentos() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', descricao: '', status: 'ativo' });

  const queryClient = useQueryClient();

  const { data: departamentos = [], isLoading } = useQuery({
    queryKey: ['departamentos'],
    queryFn: () => base44.entities.Departamento.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Departamento.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['departamentos']);
      setFormOpen(false);
      resetForm();
      toast.success('✅ Departamento criado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar departamento: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Departamento.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['departamentos']);
      setFormOpen(false);
      resetForm();
      toast.success('✅ Departamento atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar departamento: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Departamento.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['departamentos']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ nome: '', descricao: '', status: 'ativo' });
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
      descricao: item.descricao || '',
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

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'descricao', label: 'Descrição' },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
          {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
          {val}
        </Badge>
      )
    }
  ];

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button 
          onClick={handleNew}
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30"
        >
          Novo Departamento
        </Button>
      </div>

      <DataTable
        data={departamentos}
        columns={columns}
        searchFields={['nome', 'descricao']}
        onEdit={handleEdit}
        onDelete={handleDelete}
        pageSize={1000}
        isLoading={isLoading}
      />

      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={selected ? 'Editar Departamento' : 'Novo Departamento'}
      >
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <Label>Nome do Departamento *</Label>
            <Input
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea
              value={formData.descricao}
              onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
              rows={3}
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
    </div>
  );
}