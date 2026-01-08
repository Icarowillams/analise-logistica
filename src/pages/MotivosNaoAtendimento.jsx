import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { AlertCircle, Upload } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function MotivosNaoAtendimento() {
  const [activeTab, setActiveTab] = useState("nao-atendimento");
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ descricao: '', status: 'ativo' });

  const queryClient = useQueryClient();

  const entityName = activeTab === 'nao-atendimento' ? 'MotivoNaoAtendimento' : 'MotivoNaoSolicitacao';
  const queryKey = activeTab === 'nao-atendimento' ? 'motivosNaoAtendimento' : 'motivosNaoSolicitacao';

  const { data: items = [] } = useQuery({
    queryKey: [queryKey],
    queryFn: () => base44.entities[entityName].list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities[entityName].create(data),
    onSuccess: () => {
      queryClient.invalidateQueries([queryKey]);
      resetForm();
      toast.success('✅ Motivo criado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities[entityName].update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries([queryKey]);
      resetForm();
      toast.success('✅ Motivo atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities[entityName].delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries([queryKey]);
      setDeleteOpen(false);
      setSelected(null);
      toast.success('✅ Motivo excluído com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao excluir: ' + error.message);
    }
  });

  const resetForm = () => {
    setFormData({ descricao: '', status: 'ativo' });
    setSelected(null);
    setFormOpen(false);
  };

  const handleNew = () => {
    resetForm();
    setFormOpen(true);
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
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

  const handleBulkImport = async (data) => {
    setIsImporting(true);
    for (const item of data) {
      await base44.entities[entityName].create({
        descricao: item.descricao,
        status: item.status || 'ativo'
      });
    }
    queryClient.invalidateQueries([queryKey]);
    setIsImporting(false);
    setBulkOpen(false);
    toast.success(`✅ ${data.length} motivo(s) importado(s) com sucesso!`);
  };

  const columns = [
    { key: 'descricao', label: 'Descrição', sortable: true },
    { 
      key: 'status', 
      label: 'Status', 
      sortable: true,
      render: (value) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          value === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
        }`}>
          {value === 'ativo' ? 'Ativo' : 'Inativo'}
        </span>
      )
    }
  ];

  const bulkColumns = [
    { key: 'descricao', label: 'Descrição', required: true },
    { key: 'status', label: 'Status' }
  ];

  const bulkExample = [
    { descricao: 'Cliente fechado', status: 'ativo' },
    { descricao: 'Sem estoque', status: 'ativo' }
  ];

  const title = activeTab === 'nao-atendimento' 
    ? 'Motivos de Não Atendimento' 
    : 'Motivos de Não Solicitação de Pedidos';

  return (
    <div>
      <PageHeader
        title="Motivos de Cadastro"
        subtitle="Gestão de motivos de não atendimento e não solicitação"
        icon={AlertCircle}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[600px] grid-cols-2 mb-6">
          <TabsTrigger value="nao-atendimento">
            Motivos de Não Atendimento
          </TabsTrigger>
          <TabsTrigger value="nao-solicitacao">
            Não Solicitação de Pedidos
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
              <div className="flex gap-2">
                <Button
                  onClick={() => setBulkOpen(true)}
                  variant="outline"
                  className="border-amber-200 text-amber-700 hover:bg-amber-50"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Importar
                </Button>
                <Button
                  onClick={handleNew}
                  className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900"
                >
                  Novo Motivo
                </Button>
              </div>
            </div>

            <DataTable
              data={items}
              columns={columns}
              searchable={true}
              searchFields={['descricao']}
              onEdit={handleEdit}
              onDelete={handleDelete}
              emptyMessage="Nenhum motivo cadastrado"
            />
          </div>
        </TabsContent>
      </Tabs>

      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={selected ? 'Editar Motivo' : 'Novo Motivo'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Descrição *</Label>
            <Input
              value={formData.descricao}
              onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
              required
              placeholder="Digite a descrição do motivo"
            />
          </div>

          <div>
            <Label>Status</Label>
            <Select 
              value={formData.status} 
              onValueChange={(v) => setFormData({ ...formData, status: v })}
            >
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
            <Button type="button" variant="outline" onClick={resetForm}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900"
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
        title={`Importar ${title}`}
        description="Importe vários motivos de uma vez usando CSV ou colando dados do Excel"
        columns={bulkColumns}
        exampleData={bulkExample}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
    </div>
  );
}