import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Network, Upload, List, Save, Ban, CheckCircle, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';

export default function Redes() {
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', cnpj: '', contato: '', email: '', telefone: '', raio_atuacao: '' });

  const queryClient = useQueryClient();

  const { data: redes = [], isLoading } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Rede.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['redes']);
      resetForm();
      setIsEditing(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Rede.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['redes']);
      resetForm();
      setIsEditing(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Rede.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['redes']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ nome: '', cnpj: '', contato: '', email: '', telefone: '', raio_atuacao: '' });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ nome: item.nome || '', cnpj: item.cnpj || '', contato: item.contato || '', email: item.email || '', telefone: item.telefone || '', raio_atuacao: item.raio_atuacao || '' });
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
      await base44.entities.Rede.create(item);
    }
    queryClient.invalidateQueries(['redes']);
    setIsImporting(false);
    setBulkOpen(false);
  };

  const bulkColumns = [
    { key: 'nome', label: 'Nome', required: true },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'contato', label: 'Contato' },
    { key: 'email', label: 'Email' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'raio_atuacao', label: 'Raio de Atuação' }
  ];

  const bulkExampleData = [
    { nome: 'Rede Exemplo 1', cnpj: '11.111.111/0001-01', contato: 'João Silva', email: 'joao@rede1.com', telefone: '(11) 3333-0001', raio_atuacao: 'Grande São Paulo' },
    { nome: 'Rede Exemplo 2', cnpj: '22.222.222/0001-02', contato: 'Maria Santos', email: 'maria@rede2.com', telefone: '(11) 3333-0002', raio_atuacao: 'Interior SP' }
  ];

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'contato', label: 'Contato' },
    { key: 'email', label: 'Email' },
    { key: 'raio_atuacao', label: 'Raio de Atuação' }
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader 
          title="Redes" 
          subtitle="Grupos empresariais"
          icon={Network}
        />
        <div className="flex gap-2">
          <Button onClick={() => setBulkOpen(true)} variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50">
            <Upload className="w-4 h-4 mr-2" />Importar em Massa
          </Button>
          <Button onClick={handleNew} className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">Nova Rede</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <Network className="w-4 h-4" />
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
                {selected ? 'Editar Rede' : 'Nova Rede'}
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
                <div>
                  <Label>CNPJ</Label>
                  <Input 
                    value={formData.cnpj} 
                    onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })} 
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Contato</Label>
                  <Input 
                    value={formData.contato} 
                    onChange={(e) => setFormData({ ...formData, contato: e.target.value })} 
                    disabled={!isEditing}
                  />
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
                  <Label>Raio de Atuação</Label>
                  <Input 
                    value={formData.raio_atuacao} 
                    onChange={(e) => setFormData({ ...formData, raio_atuacao: e.target.value })} 
                    placeholder="Ex: Grande São Paulo" 
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
          <DataTable data={redes} columns={columns} searchFields={['nome', 'cnpj']} onEdit={handleEdit} onDelete={handleDelete} pageSize={1000} isLoading={isLoading} />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} isDeleting={deleteMutation.isPending} />
      
      <BulkImportModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Importar Redes em Massa"
        description="Importe várias redes de uma vez"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
    </div>
  );
}