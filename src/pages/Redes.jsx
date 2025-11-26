import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Network } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Redes() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'contato', label: 'Contato' },
    { key: 'email', label: 'Email' },
    { key: 'raio_atuacao', label: 'Raio de Atuação' }
  ];

  return (
    <div>
      <PageHeader title="Redes/Franquias" subtitle="Grupos empresariais" icon={Network} action={handleNew} actionLabel="Nova Rede" />
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
    </div>
  );
}