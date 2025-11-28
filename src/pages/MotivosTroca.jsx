import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowLeftRight, Upload, List, Save, Ban, CheckCircle, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function MotivosTroca() {
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ descricao: '', codigo: '', categoria: '' });

  const queryClient = useQueryClient();

  const { data: motivos = [], isLoading } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MotivoTroca.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['motivosTroca']);
      resetForm();
      setIsEditing(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MotivoTroca.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['motivosTroca']);
      resetForm();
      setIsEditing(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MotivoTroca.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['motivosTroca']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ descricao: '', codigo: '', categoria: '' });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ descricao: item.descricao || '', codigo: item.codigo || '', categoria: item.categoria || '' });
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
    for (const item of data) {
      await base44.entities.MotivoTroca.create(item);
    }
    queryClient.invalidateQueries(['motivosTroca']);
    setIsImporting(false);
    setBulkOpen(false);
  };

  const bulkColumns = [
    { key: 'descricao', label: 'Descrição', required: true },
    { key: 'codigo', label: 'Código', required: true },
    { key: 'categoria', label: 'Categoria' }
  ];

  const bulkExampleData = [
    { descricao: 'Produto danificado', codigo: 'DAN', categoria: 'defeito' },
    { descricao: 'Troca por preferência', codigo: 'PREF', categoria: 'cliente_solicitou' }
  ];

  const categoriaLabels = {
    defeito: 'Defeito',
    cliente_solicitou: 'Cliente Solicitou',
    vencimento: 'Vencimento',
    estoque: 'Estoque',
    outro: 'Outro'
  };

  const columns = [
    { key: 'codigo', label: 'Código', sortable: true },
    { key: 'descricao', label: 'Descrição', sortable: true },
    { key: 'categoria', label: 'Categoria', render: (val) => <Badge variant="secondary">{categoriaLabels[val] || val}</Badge> }
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader 
          title="Motivos de Troca" 
          subtitle="Razões para trocas de produtos"
          icon={ArrowLeftRight}
        />
        <div className="flex gap-2">
          <Button onClick={() => setBulkOpen(true)} variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50">
            <Upload className="w-4 h-4 mr-2" />Importar em Massa
          </Button>
          <Button onClick={handleNew} className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">Novo Motivo</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4" />
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
                {selected ? 'Editar Motivo' : 'Novo Motivo'}
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
                  />
                </div>
                <div>
                  <Label>Código *</Label>
                  <Input 
                    value={formData.codigo} 
                    onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} 
                    required 
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Select 
                    value={formData.categoria} 
                    onValueChange={(v) => setFormData({ ...formData, categoria: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="defeito">Defeito</SelectItem>
                      <SelectItem value="cliente_solicitou">Cliente Solicitou</SelectItem>
                      <SelectItem value="vencimento">Vencimento</SelectItem>
                      <SelectItem value="estoque">Estoque</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
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
          <DataTable data={motivos} columns={columns} searchFields={['descricao', 'codigo']} onEdit={handleEdit} onDelete={handleDelete} isLoading={isLoading} />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} isDeleting={deleteMutation.isPending} />
      
      <BulkImportModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Importar Motivos em Massa"
        description="Importe vários motivos de uma vez"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
    </div>
  );
}