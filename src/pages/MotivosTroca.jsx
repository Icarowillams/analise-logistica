import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { ArrowLeftRight, Upload, List, Save, Ban, ShoppingCart, UserX, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function MotivosTroca() {
  const [mainTab, setMainTab] = useState("troca");
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ descricao: '' });

  const queryClient = useQueryClient();

  // Dados de Motivo de Troca
  const { data: motivosTroca = [], isLoading: loadingTroca } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
  });

  // Dados de Motivo Não Pedido
  const { data: motivosNaoPedido = [], isLoading: loadingNaoPedido } = useQuery({
    queryKey: ['motivosNaoSolicitacao'],
    queryFn: () => base44.entities.MotivoNaoSolicitacao.list()
  });

  // Dados de Motivo Não Atendimento
  const { data: motivosNaoAtendimento = [], isLoading: loadingNaoAtendimento } = useQuery({
    queryKey: ['motivosNaoAtendimento'],
    queryFn: () => base44.entities.MotivoNaoAtendimento.list()
  });

  const getEntityName = () => {
    switch (mainTab) {
      case 'troca': return 'MotivoTroca';
      case 'naoPedido': return 'MotivoNaoSolicitacao';
      case 'naoAtendimento': return 'MotivoNaoAtendimento';
      default: return 'MotivoTroca';
    }
  };

  const getQueryKey = () => {
    switch (mainTab) {
      case 'troca': return ['motivosTroca'];
      case 'naoPedido': return ['motivosNaoSolicitacao'];
      case 'naoAtendimento': return ['motivosNaoAtendimento'];
      default: return ['motivosTroca'];
    }
  };

  const getData = () => {
    switch (mainTab) {
      case 'troca': return motivosTroca;
      case 'naoPedido': return motivosNaoPedido;
      case 'naoAtendimento': return motivosNaoAtendimento;
      default: return [];
    }
  };

  const isLoading = () => {
    switch (mainTab) {
      case 'troca': return loadingTroca;
      case 'naoPedido': return loadingNaoPedido;
      case 'naoAtendimento': return loadingNaoAtendimento;
      default: return false;
    }
  };

  const getTabTitle = () => {
    switch (mainTab) {
      case 'troca': return 'Ocorrência de Troca';
      case 'naoPedido': return 'Motivo Não Pedido';
      case 'naoAtendimento': return 'Motivo Não Atendimento';
      default: return 'Ocorrência';
    }
  };

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities[getEntityName()].create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(getQueryKey());
      resetForm();
      setIsEditing(false);
      toast.success('✅ Registro criado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar registro: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities[getEntityName()].update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(getQueryKey());
      resetForm();
      setIsEditing(false);
      toast.success('✅ Registro atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar registro: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities[getEntityName()].delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(getQueryKey());
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ descricao: '' });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ descricao: item.descricao || '' });
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleCancel = () => {
    resetForm();
    setIsEditing(false);
  };

  const handleDelete = (item) => { setSelected(item); setDeleteOpen(true); };

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
    try {
      await base44.entities[getEntityName()].bulkCreate(data);
      queryClient.invalidateQueries(getQueryKey());
      toast.success('✅ Importação concluída com sucesso!');
    } catch (error) {
      toast.error('❌ Erro na importação: ' + error.message);
    }
    setIsImporting(false);
    setBulkOpen(false);
  };

  const handleMainTabChange = (tab) => {
    setMainTab(tab);
    resetForm();
    setIsEditing(false);
    setActiveTab("cadastro");
  };

  const bulkColumns = [
    { key: 'descricao', label: 'Descrição', required: true }
  ];

  const bulkExampleData = [
    { descricao: 'Exemplo 1' },
    { descricao: 'Exemplo 2' }
  ];

  const columns = [
    { key: 'descricao', label: 'Descrição', sortable: true }
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader 
          title="Ocorrências - Motivos" 
          subtitle="Gerenciamento de motivos para trocas, não pedidos e não atendimentos"
          icon={AlertCircle}
        />
        <div className="flex gap-2">
          <Button onClick={() => setBulkOpen(true)} variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50">
            <Upload className="w-4 h-4 mr-2" />Importar em Massa
          </Button>
          <Button onClick={handleNew} className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">Novo Registro</Button>
        </div>
      </div>

      {/* Abas principais */}
      <Tabs value={mainTab} onValueChange={handleMainTabChange} className="w-full mb-6">
        <TabsList className="grid w-full max-w-[600px] grid-cols-3">
          <TabsTrigger value="troca" className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4" />
            Troca
          </TabsTrigger>
          <TabsTrigger value="naoPedido" className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            Não Pedido
          </TabsTrigger>
          <TabsTrigger value="naoAtendimento" className="flex items-center gap-2">
            <UserX className="w-4 h-4" />
            Não Atendimento
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Card informativo */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mb-6">
        <h3 className="font-semibold text-amber-900 mb-1">{getTabTitle()}</h3>
        <p className="text-sm text-amber-800">
          {mainTab === 'troca' && 'Motivos utilizados para justificar trocas de produtos.'}
          {mainTab === 'naoPedido' && 'Motivos que os vendedores devem informar quando o cliente não solicita pedido.'}
          {mainTab === 'naoAtendimento' && 'Motivos que devem ser informados quando um cliente não é atendido na visita.'}
        </p>
      </div>

      {/* Abas de Cadastro/Consulta */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
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
                {selected ? `Editar ${getTabTitle()}` : `Novo ${getTabTitle()}`}
              </h2>
              {!isEditing && (
                <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
                  Modo Visualização
                </Badge>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label>Descrição *</Label>
                  <Input 
                    value={formData.descricao} 
                    onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} 
                    required 
                    disabled={!isEditing}
                    placeholder="Descreva o motivo..."
                  />
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
                    className="bg-gradient-to-r from-indigo-500 to-purple-600"
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
          <DataTable data={getData()} columns={columns} searchFields={['descricao']} onEdit={handleEdit} onDelete={handleDelete} pageSize={1000} isLoading={isLoading()} />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} isDeleting={deleteMutation.isPending} />
      
      <BulkImportModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Importar ${getTabTitle()} em Massa`}
        description="Importe vários registros de uma vez"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
    </div>
  );
}