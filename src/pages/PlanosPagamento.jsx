import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { CreditCard, CheckCircle, XCircle, List, Save, Ban } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PlanosPagamento() {
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', numero_parcelas: 1, juros_percentual: 0, dias_primeira_parcela: 30, condicoes: '', status: 'ativo' });

  const queryClient = useQueryClient();

  const { data: planos = [], isLoading } = useQuery({
    queryKey: ['planosPagamento'],
    queryFn: () => base44.entities.PlanoPagamento.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.PlanoPagamento.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['planosPagamento']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Plano criado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar plano: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PlanoPagamento.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['planosPagamento']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Plano atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar plano: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PlanoPagamento.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['planosPagamento']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ nome: '', numero_parcelas: 1, juros_percentual: 0, dias_primeira_parcela: 30, condicoes: '', status: 'ativo' });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
      nome: item.nome || '', numero_parcelas: item.numero_parcelas || 1, juros_percentual: item.juros_percentual || 0,
      dias_primeira_parcela: item.dias_primeira_parcela || 30, condicoes: item.condicoes || '', status: item.status || 'ativo'
    });
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
    const data = { ...formData, numero_parcelas: parseInt(formData.numero_parcelas), juros_percentual: parseFloat(formData.juros_percentual), dias_primeira_parcela: parseInt(formData.dias_primeira_parcela) };
    if (selected) {
      updateMutation.mutate({ id: selected.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'numero_parcelas', label: 'Parcelas' },
    { key: 'juros_percentual', label: 'Juros (%)', render: (v) => `${v || 0}%` },
    { key: 'dias_primeira_parcela', label: 'Dias 1ª Parcela' },
    { key: 'status', label: 'Status', render: (val) => (
      <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
        {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}{val}
      </Badge>
    )}
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader 
          title="Planos de Pagamento" 
          subtitle="Condições comerciais"
          icon={CreditCard}
        />
        <div className="flex gap-2">
          <Button onClick={handleNew} className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">Novo Plano</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
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
                {selected ? 'Editar Plano' : 'Novo Plano'}
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
                  <Label>Número de Parcelas *</Label>
                  <Input 
                    type="number" 
                    min="1" 
                    value={formData.numero_parcelas} 
                    onChange={(e) => setFormData({ ...formData, numero_parcelas: e.target.value })} 
                    required 
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Juros (%)</Label>
                  <Input 
                    type="number" 
                    step="0.01" 
                    value={formData.juros_percentual} 
                    onChange={(e) => setFormData({ ...formData, juros_percentual: e.target.value })} 
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Dias para 1ª Parcela</Label>
                  <Input 
                    type="number" 
                    value={formData.dias_primeira_parcela} 
                    onChange={(e) => setFormData({ ...formData, dias_primeira_parcela: e.target.value })} 
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select 
                    value={formData.status} 
                    onValueChange={(v) => setFormData({ ...formData, status: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="inativo">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label>Condições</Label>
                  <Textarea 
                    value={formData.condicoes} 
                    onChange={(e) => setFormData({ ...formData, condicoes: e.target.value })} 
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
          <DataTable data={planos} columns={columns} searchFields={['nome']} onEdit={handleEdit} onDelete={handleDelete} pageSize={1000} isLoading={isLoading} />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} isDeleting={deleteMutation.isPending} />
    </div>
  );
}