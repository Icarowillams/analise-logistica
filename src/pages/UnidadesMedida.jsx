import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Scale, List, Save, Ban, Package } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';

export default function UnidadesMedida() {
  const [activeMainTab, setActiveMainTab] = useState("medida"); // medida | produto
  const [activeSubTab, setActiveSubTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '' });

  const queryClient = useQueryClient();

  // Queries
  const { data: unidadesMedida = [], isLoading: isLoadingMedida } = useQuery({
    queryKey: ['unidadesMedida'],
    queryFn: () => base44.entities.UnidadeMedida.list()
  });

  const { data: unidadesProduto = [], isLoading: isLoadingProduto } = useQuery({
    queryKey: ['unidadesProduto'],
    queryFn: () => base44.entities.UnidadeProduto.list()
  });

  // Mutations - Medida
  const createMedidaMutation = useMutation({
    mutationFn: (data) => base44.entities.UnidadeMedida.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['unidadesMedida']);
      resetForm();
      setIsEditing(false);
    }
  });

  const updateMedidaMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.UnidadeMedida.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['unidadesMedida']);
      resetForm();
      setIsEditing(false);
    }
  });

  const deleteMedidaMutation = useMutation({
    mutationFn: (id) => base44.entities.UnidadeMedida.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['unidadesMedida']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  // Mutations - Produto
  const createProdutoMutation = useMutation({
    mutationFn: (data) => base44.entities.UnidadeProduto.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['unidadesProduto']);
      resetForm();
      setIsEditing(false);
    }
  });

  const updateProdutoMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.UnidadeProduto.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['unidadesProduto']);
      resetForm();
      setIsEditing(false);
    }
  });

  const deleteProdutoMutation = useMutation({
    mutationFn: (id) => base44.entities.UnidadeProduto.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['unidadesProduto']);
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
    setActiveSubTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ nome: item.nome || '' });
    setIsEditing(true);
    setActiveSubTab("cadastro");
  };

  const handleCancel = () => {
    resetForm();
    setIsEditing(false);
  };

  const handleDelete = (item) => { setSelected(item); setDeleteOpen(true); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (activeMainTab === 'medida') {
      if (selected) updateMedidaMutation.mutate({ id: selected.id, data: formData });
      else createMedidaMutation.mutate(formData);
    } else {
      if (selected) updateProdutoMutation.mutate({ id: selected.id, data: formData });
      else createProdutoMutation.mutate(formData);
    }
  };

  const confirmDelete = () => {
    if (activeMainTab === 'medida') deleteMedidaMutation.mutate(selected?.id);
    else deleteProdutoMutation.mutate(selected?.id);
  };

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true }
  ];

  const isProcessing = 
    createMedidaMutation.isPending || 
    updateMedidaMutation.isPending || 
    deleteMedidaMutation.isPending ||
    createProdutoMutation.isPending ||
    updateProdutoMutation.isPending ||
    deleteProdutoMutation.isPending;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader 
          title="Configurações de Unidades" 
          subtitle="Gerencie unidades de medida e tipos de produto"
          icon={Scale}
        />
        <Button onClick={handleNew} className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
          Nova {activeMainTab === 'medida' ? 'Unidade de Medida' : 'Unidade de Produto'}
        </Button>
      </div>

      <Tabs value={activeMainTab} onValueChange={(v) => { setActiveMainTab(v); resetForm(); setIsEditing(false); }} className="w-full mb-6">
        <TabsList className="w-full max-w-[400px] grid grid-cols-2">
          <TabsTrigger value="medida">Unidade de Medida</TabsTrigger>
          <TabsTrigger value="produto">Unidade de Produto</TabsTrigger>
        </TabsList>
      </Tabs>

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            {activeMainTab === 'medida' ? <Scale className="w-4 h-4" /> : <Package className="w-4 h-4" />}
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
                {selected ? 'Editar' : 'Nova'} {activeMainTab === 'medida' ? 'Unidade de Medida' : 'Unidade de Produto'}
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
                  placeholder={activeMainTab === 'medida' ? "Ex: KG, UN, CX" : "Ex: CX, UN, FARDO"}
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
                    disabled={isProcessing} 
                    className="bg-gradient-to-r from-indigo-500 to-purple-600"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {isProcessing ? 'Salvando...' : 'Salvar'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </TabsContent>
        
        <TabsContent value="consulta" className="animate-in fade-in-50 duration-300">
          <DataTable 
            data={activeMainTab === 'medida' ? unidadesMedida : unidadesProduto} 
            columns={columns} 
            searchFields={['nome']} 
            onEdit={handleEdit} 
            onDelete={handleDelete} 
            pageSize={50} 
            isLoading={activeMainTab === 'medida' ? isLoadingMedida : isLoadingProduto} 
          />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog 
        open={deleteOpen} 
        onOpenChange={setDeleteOpen} 
        onConfirm={confirmDelete} 
        isDeleting={isProcessing} 
      />
    </div>
  );
}