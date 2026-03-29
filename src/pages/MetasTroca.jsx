import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowLeftRight } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export default function MetasTroca() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ vendedor_id: '', periodo: '', meta_trocas: 0 });
  const [tipoMeta, setTipoMeta] = useState('individual');

  const queryClient = useQueryClient();

  const { data: metas = [], isLoading } = useQuery({ queryKey: ['metasTroca'], queryFn: () => base44.entities.MetaTroca.list() });
  const { data: vendedoresAll = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: funcoes = [] } = useQuery({ queryKey: ['funcoes'], queryFn: () => base44.entities.Funcao.list() });
  const { data: trocas = [] } = useQuery({ queryKey: ['trocas'], queryFn: () => base44.entities.Troca.list('-data', 2000) });

  const vendedores = useMemo(() => {
    const funcaoVendedor = funcoes.find(f => f.nome?.toLowerCase() === 'vendedor');
    return vendedoresAll.filter(v => {
      if (v.status !== 'ativo') return false;
      if (funcaoVendedor && v.funcao_id === funcaoVendedor.id) return true;
      if (v.funcao?.toLowerCase() === 'vendedor') return true;
      return false;
    });
  }, [vendedoresAll, funcoes]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MetaTroca.create(data),
    onSuccess: () => { queryClient.invalidateQueries(['metasTroca']); setFormOpen(false); resetForm(); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MetaTroca.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['metasTroca']); setFormOpen(false); resetForm(); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MetaTroca.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['metasTroca']); setDeleteOpen(false); setSelected(null); }
  });

  const resetForm = () => { setFormData({ vendedor_id: '', periodo: '', meta_trocas: 0 }); setSelected(null); setTipoMeta('individual'); };
  const handleNew = () => { resetForm(); setFormOpen(true); };
  const handleEdit = (item) => {
    setSelected(item);
    setFormData({ vendedor_id: item.vendedor_id || '', periodo: item.periodo || '', meta_trocas: item.meta_trocas || 0 });
    setTipoMeta(item.vendedor_id ? 'individual' : 'equipe');
    setFormOpen(true);
  };
  const handleDelete = (item) => { setSelected(item); setDeleteOpen(true); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (tipoMeta === 'equipe') {
      const metaVal = parseInt(formData.meta_trocas) || 0;
      if (selected) {
        const data = { ...formData, vendedor_id: formData.vendedor_id || '', vendedor_nome: formData.vendedor_id ? vendedores.find(v => v.id === formData.vendedor_id)?.nome || '' : 'Equipe', meta_trocas: metaVal };
        updateMutation.mutate({ id: selected.id, data });
      } else {
        const promises = vendedores.map(v => {
          return base44.entities.MetaTroca.create({
            vendedor_id: v.id,
            vendedor_nome: v.nome,
            periodo: formData.periodo,
            meta_trocas: metaVal
          });
        });
        Promise.all(promises).then(() => {
          queryClient.invalidateQueries(['metasTroca']);
          setFormOpen(false);
          resetForm();
        });
      }
    } else {
      const vendedor = vendedores.find(v => v.id === formData.vendedor_id);
      const data = { ...formData, vendedor_nome: vendedor?.nome || '', meta_trocas: parseInt(formData.meta_trocas) || 0 };
      if (selected) { updateMutation.mutate({ id: selected.id, data }); }
      else { createMutation.mutate(data); }
    }
  };

  const calcularRealizado = (meta) => {
    return trocas.filter(t => t.vendedor_id === meta.vendedor_id && t.data?.startsWith(meta.periodo)).length;
  };

  const columns = [
    { key: 'periodo', label: 'Período', sortable: true },
    { key: 'vendedor_nome', label: 'Vendedor', sortable: true, render: (v) => v || 'Equipe' },
    { key: 'meta_trocas', label: 'Meta Máx. Trocas (%)', render: (v) => `${v}%` },
    { 
      key: 'realizado', 
      label: 'Trocas Realizadas',
      render: (_, item) => {
        const realizado = calcularRealizado(item);
        // Para trocas, quanto MENOR, melhor
        const percent = item.meta_trocas ? Math.min((realizado / item.meta_trocas) * 100, 100) : 0;
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <Progress value={percent} className="h-2 flex-1" />
            <span className="text-xs font-medium">{realizado}</span>
          </div>
        );
      }
    },
    { 
      key: 'status', 
      label: 'Status',
      render: (_, item) => {
        const realizado = calcularRealizado(item);
        const dentroMeta = realizado <= item.meta_trocas;
        return (
          <Badge className={dentroMeta ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
            {dentroMeta ? 'Dentro da Meta' : 'Acima da Meta'}
          </Badge>
        );
      }
    }
  ];

  return (
    <div>
      <PageHeader title="Meta por Troca" subtitle="Metas máximas de trocas por vendedor" icon={ArrowLeftRight} action={handleNew} actionLabel="Nova Meta" />
      <DataTable data={metas} columns={columns} searchFields={['vendedor_nome', 'periodo']} onEdit={handleEdit} onDelete={handleDelete} isLoading={isLoading} />
      
      <FormModal open={formOpen} onOpenChange={setFormOpen} title={selected ? 'Editar Meta' : 'Nova Meta'}>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-4">
            {!selected && (
              <div>
                <Label className="mb-2 block">Tipo de Meta</Label>
                <RadioGroup value={tipoMeta} onValueChange={(v) => { setTipoMeta(v); if (v === 'equipe') setFormData(prev => ({ ...prev, vendedor_id: '' })); }} className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="individual" id="troca-individual" />
                    <Label htmlFor="troca-individual" className="cursor-pointer">Vendedor Individual</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="equipe" id="troca-equipe" />
                    <Label htmlFor="troca-equipe" className="cursor-pointer">Equipe Inteira</Label>
                  </div>
                </RadioGroup>
                {tipoMeta === 'equipe' && (
                  <p className="text-xs text-amber-600 mt-1">A meta será criada para todos os vendedores com o mesmo valor.</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tipoMeta === 'individual' && (
                <div>
                  <Label>Vendedor *</Label>
                  <Select value={formData.vendedor_id} onValueChange={(v) => setFormData({ ...formData, vendedor_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>{vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Período *</Label>
                <Input type="month" value={formData.periodo} onChange={(e) => setFormData({ ...formData, periodo: e.target.value })} required />
              </div>
              <div>
                <Label>Meta Máx. Trocas (%) *</Label>
                <Input type="number" step="0.1" value={formData.meta_trocas} onChange={(e) => setFormData({ ...formData, meta_trocas: e.target.value })} required placeholder="Ex: 5" />
              </div>
            </div>
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