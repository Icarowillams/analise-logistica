import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Scale, List, Save, Ban, Pencil, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';

export default function UnidadesMedida() {
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '' });

  const queryClient = useQueryClient();

  const { data: unidades = [], isLoading } = useQuery({
    queryKey: ['unidadesMedida'],
    queryFn: () => base44.entities.UnidadeMedida.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.UnidadeMedida.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['unidadesMedida']);
      resetForm();
      setIsEditing(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.UnidadeMedida.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['unidadesMedida']);
      resetForm();
      setIsEditing(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.UnidadeMedida.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['unidadesMedida']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ nome: '' });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ nome: item.nome || '' });
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

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true }
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader 
          title="Unidades de Medida" 
          subtitle="Gerenciamento de unidades (KG, UN, CX...)"
          icon={Scale}
        />
        <Button onClick={handleNew} className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">Nova Unidade</Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <Scale className="w-4 h-4" />
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
                {selected ? 'Editar Unidade' : 'Nova Unidade'}
              </h2>
              {!isEditing && (
                <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
                  Modo Visualização
                </Badge>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="max-w-md">
                <Label>Nome da Unidade *</Label>
                <Input 
                  value={formData.nome} 
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })} 
                  required 
                  disabled={!isEditing}
                  placeholder="Ex: UN, KG, CX"
                />
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
          <DataTable 
            data={unidades} 
            columns={columns} 
            searchFields={['nome']} 
            onEdit={handleEdit} 
            onDelete={handleDelete} 
            pageSize={50} 
            isLoading={isLoading} 
          />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog 
        open={deleteOpen} 
        onOpenChange={setDeleteOpen} 
        onConfirm={() => deleteMutation.mutate(selected?.id)} 
        isDeleting={deleteMutation.isPending} 
      />
    </div>
  );
}