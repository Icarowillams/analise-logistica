import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Tag, Upload, List, Save, Ban, CheckCircle, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';

export default function Segmentos() {
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', descricao: '' });

  const queryClient = useQueryClient();

  const { data: segmentos = [], isLoading } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Segmento.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['segmentos']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Segmento criado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar segmento: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Segmento.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['segmentos']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Segmento atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar segmento: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Segmento.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['segmentos']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ nome: '', descricao: '' });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ nome: item.nome || '', descricao: item.descricao || '' });
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleView = (item) => {
    setSelected(item);
    setFormData({ nome: item.nome || '', descricao: item.descricao || '' });
    setIsEditing(false);
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
    for (const item of data) {
      await base44.entities.Segmento.create(item);
    }
    queryClient.invalidateQueries(['segmentos']);
    setIsImporting(false);
    setBulkOpen(false);
  };

  const bulkColumns = [
    { key: 'nome', label: 'Nome', required: true },
    { key: 'descricao', label: 'Descrição' }
  ];

  const bulkExampleData = [
    { nome: 'Varejo', descricao: 'Lojas de varejo' },
    { nome: 'Atacado', descricao: 'Atacadistas e distribuidores' }
  ];

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'descricao', label: 'Descrição' }
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader 
          title="Segmentos" 
          subtitle="Categorização de clientes"
          icon={Tag}
        />
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button onClick={() => setBulkOpen(true)} variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 w-full sm:w-auto justify-center">
            <Upload className="w-4 h-4 mr-2" />Importar em Massa
          </Button>
          <Button onClick={handleNew} className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white w-full sm:w-auto">Novo Segmento</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <Tag className="w-4 h-4" />
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
                {!isEditing && selected ? 'Visualizar Segmento' : selected ? 'Editar Segmento' : 'Novo Segmento'}
              </h2>
              {!isEditing && (
                <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
                  Modo Visualização
                </Badge>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label>Nome *</Label>
                  <Input 
                    value={formData.nome} 
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })} 
                    required 
                    disabled={!isEditing}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Descrição</Label>
                  <Textarea 
                    value={formData.descricao} 
                    onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} 
                    disabled={!isEditing}
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
          <DataTable data={segmentos} columns={columns} searchFields={['nome']} onView={handleView} onEdit={handleEdit} onDelete={handleDelete} pageSize={1000} isLoading={isLoading} />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} isDeleting={deleteMutation.isPending} />
      
      <BulkImportModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Importar Segmentos em Massa"
        description="Importe vários segmentos de uma vez"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
    </div>
  );
}