import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Network, Upload } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Redes() {
  const [formOpen, setFormOpen] = useState(false);
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
    onSuccess: () => { queryClient.invalidateQueries(['redes']); setFormOpen(false); resetForm(); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Rede.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['redes']); setFormOpen(false); resetForm(); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Rede.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['redes']); setDeleteOpen(false); setSelected(null); }
  });

  const resetForm = () => {
    setFormData({ nome: '', cnpj: '', contato: '', email: '', telefone: '', raio_atuacao: '' });
    setSelected(null);
  };

  const handleNew = () => { resetForm(); setFormOpen(true); };
  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ nome: item.nome || '', cnpj: item.cnpj || '', contato: item.contato || '', email: item.email || '', telefone: item.telefone || '', raio_atuacao: item.raio_atuacao || '' });
    setFormOpen(true);
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
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Network className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Redes/Franquias</h1>
            <p className="text-slate-500 mt-0.5">Grupos empresariais</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setBulkOpen(true)} variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50">
            <Upload className="w-4 h-4 mr-2" />Importar em Massa
          </Button>
          <Button onClick={handleNew} className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">Nova Rede</Button>
        </div>
      </div>
      <DataTable data={redes} columns={columns} searchFields={['nome', 'cnpj']} onEdit={handleEdit} onDelete={handleDelete} isLoading={isLoading} />
      
      <FormModal open={formOpen} onOpenChange={setFormOpen} title={selected ? 'Editar Rede' : 'Nova Rede'}>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2"><Label>Nome *</Label><Input value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} required /></div>
            <div><Label>CNPJ</Label><Input value={formData.cnpj} onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })} /></div>
            <div><Label>Contato</Label><Input value={formData.contato} onChange={(e) => setFormData({ ...formData, contato: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} /></div>
            <div><Label>Telefone</Label><Input value={formData.telefone} onChange={(e) => setFormData({ ...formData, telefone: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>Raio de Atuação</Label><Input value={formData.raio_atuacao} onChange={(e) => setFormData({ ...formData, raio_atuacao: e.target.value })} placeholder="Ex: Grande São Paulo" /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="bg-gradient-to-r from-indigo-500 to-purple-600">
              {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </FormModal>

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