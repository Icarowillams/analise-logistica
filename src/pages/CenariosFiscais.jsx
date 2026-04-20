import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { FileText, Plus, Pencil, Trash2, Save, Ban, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';

const initialForm = {
  tipo_registro: 'cenario',
  codigo: '', nome: '', descricao: '', cfop: '', natureza_operacao: '',
  tipo_nota: '55', cst_icms: '', aliquota_icms: '',
  cst_pis: '', aliquota_pis: '', cst_cofins: '', aliquota_cofins: '',
  omie_id: '', status: 'ativo', observacoes: ''
};

export default function CenariosFiscais() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [tab, setTab] = useState('cenario');
  const [importando, setImportando] = useState(false);

  const handleImportarOmie = async () => {
    if (!window.confirm('Importar Cenários (Naturezas) e Etapas de Faturamento do Omie?')) return;
    setImportando(true);
    try {
      const res = await base44.functions.invoke('importarCenariosFiscaisOmie', {});
      const d = res.data;
      if (d.sucesso) {
        toast.success(
          `✅ ${d.cenarios.criados + d.cenarios.atualizados} cenários e ${d.etapas.criadas + d.etapas.atualizadas} etapas sincronizados`
        );
        qc.invalidateQueries(['cenariosFiscais']);
      } else {
        toast.error('❌ ' + (d.error || 'Erro desconhecido'));
      }
    } catch (e) {
      toast.error('❌ ' + e.message);
    } finally {
      setImportando(false);
    }
  };

  const { data: cenarios = [] } = useQuery({
    queryKey: ['cenariosFiscais'],
    queryFn: () => base44.entities.CenarioFiscal.list()
  });

  const saveMutation = useMutation({
    mutationFn: (data) => selected
      ? base44.entities.CenarioFiscal.update(selected.id, data)
      : base44.entities.CenarioFiscal.create(data),
    onSuccess: () => {
      qc.invalidateQueries(['cenariosFiscais']);
      toast.success(selected ? '✅ Cenário atualizado' : '✅ Cenário criado');
      closeModal();
    },
    onError: (e) => toast.error('❌ ' + e.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CenarioFiscal.delete(id),
    onSuccess: () => {
      qc.invalidateQueries(['cenariosFiscais']);
      toast.success('Cenário excluído');
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const openNew = () => { setSelected(null); setForm({ ...initialForm, tipo_registro: tab }); setModalOpen(true); };
  const openEdit = (c) => { setSelected(c); setForm({ ...initialForm, ...c }); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setSelected(null); setForm(initialForm); };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {
      ...form,
      aliquota_icms: form.aliquota_icms ? Number(form.aliquota_icms) : undefined,
      aliquota_pis: form.aliquota_pis ? Number(form.aliquota_pis) : undefined,
      aliquota_cofins: form.aliquota_cofins ? Number(form.aliquota_cofins) : undefined
    };
    saveMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
            <FileText className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Cenários Fiscais</h1>
            <p className="text-sm text-neutral-500">Configurações de tributação e emissão de nota</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleImportarOmie}
            disabled={importando}
            variant="outline"
            className="border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            {importando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Importar do Omie
          </Button>
          <Button onClick={openNew} className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold">
            <Plus className="w-4 h-4 mr-2" />Novo
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="cenario">
            Cenários / Naturezas ({cenarios.filter(c => (c.tipo_registro || 'cenario') === 'cenario').length})
          </TabsTrigger>
          <TabsTrigger value="etapa">
            Etapas de Faturamento ({cenarios.filter(c => c.tipo_registro === 'etapa').length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cenario">
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">Código</th>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">Nome</th>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">CFOP</th>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">Nota</th>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">ICMS</th>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">Omie ID</th>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">Status</th>
                  <th className="text-right p-3 text-xs font-semibold text-slate-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {cenarios.filter(c => (c.tipo_registro || 'cenario') === 'cenario').map(c => (
                  <tr key={c.id} className="border-b hover:bg-slate-50">
                    <td className="p-3 text-sm font-mono">{c.codigo || '-'}</td>
                    <td className="p-3 text-sm font-medium">{c.nome}</td>
                    <td className="p-3 text-sm font-mono">{c.cfop || '-'}</td>
                    <td className="p-3 text-sm"><Badge variant="outline">{c.tipo_nota}</Badge></td>
                    <td className="p-3 text-sm">{c.aliquota_icms != null ? `${c.aliquota_icms}%` : '-'}</td>
                    <td className="p-3 text-xs font-mono text-slate-500">{c.omie_id || '-'}</td>
                    <td className="p-3"><Badge className={c.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>{c.status}</Badge></td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => { setSelected(c); setDeleteOpen(true); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    </td>
                  </tr>
                ))}
                {cenarios.filter(c => (c.tipo_registro || 'cenario') === 'cenario').length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-slate-400">Nenhum cenário cadastrado — clique em "Importar do Omie"</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="etapa">
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">Código</th>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">Operação / Etapa</th>
                  <th className="text-left p-3 text-xs font-semibold text-slate-600">Status</th>
                  <th className="text-right p-3 text-xs font-semibold text-slate-600">Ações</th>
                </tr>
              </thead>
              <tbody>
                {cenarios.filter(c => c.tipo_registro === 'etapa').map(c => (
                  <tr key={c.id} className="border-b hover:bg-slate-50">
                    <td className="p-3 text-sm font-mono">{c.codigo || '-'}</td>
                    <td className="p-3 text-sm font-medium">{c.nome}</td>
                    <td className="p-3"><Badge className={c.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>{c.status}</Badge></td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => { setSelected(c); setDeleteOpen(true); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    </td>
                  </tr>
                ))}
                {cenarios.filter(c => c.tipo_registro === 'etapa').length === 0 && (
                  <tr><td colSpan={4} className="p-8 text-center text-slate-400">Nenhuma etapa cadastrada — clique em "Importar do Omie"</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected ? 'Editar Cenário Fiscal' : 'Novo Cenário Fiscal'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Código</Label><Input value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value })} /></div>
              <div><Label>Nome *</Label><Input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
              <div className="col-span-2"><Label>Descrição</Label><Input value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} /></div>
              <div><Label>CFOP</Label><Input value={form.cfop} onChange={e => setForm({ ...form, cfop: e.target.value })} placeholder="Ex: 5102" /></div>
              <div><Label>Natureza da Operação</Label><Input value={form.natureza_operacao} onChange={e => setForm({ ...form, natureza_operacao: e.target.value })} /></div>
              <div><Label>Modelo da Nota</Label>
                <Select value={form.tipo_nota} onValueChange={v => setForm({ ...form, tipo_nota: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="55">55 - NF-e</SelectItem>
                    <SelectItem value="65">65 - NFC-e</SelectItem>
                    <SelectItem value="D1">D1 - Venda sem NF (interna)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>ID Omie</Label><Input value={form.omie_id} onChange={e => setForm({ ...form, omie_id: e.target.value })} /></div>
              <div><Label>CST/CSOSN ICMS</Label><Input value={form.cst_icms} onChange={e => setForm({ ...form, cst_icms: e.target.value })} /></div>
              <div><Label>Alíquota ICMS (%)</Label><Input type="number" step="0.01" value={form.aliquota_icms} onChange={e => setForm({ ...form, aliquota_icms: e.target.value })} /></div>
              <div><Label>CST PIS</Label><Input value={form.cst_pis} onChange={e => setForm({ ...form, cst_pis: e.target.value })} /></div>
              <div><Label>Alíquota PIS (%)</Label><Input type="number" step="0.01" value={form.aliquota_pis} onChange={e => setForm({ ...form, aliquota_pis: e.target.value })} /></div>
              <div><Label>CST COFINS</Label><Input value={form.cst_cofins} onChange={e => setForm({ ...form, cst_cofins: e.target.value })} /></div>
              <div><Label>Alíquota COFINS (%)</Label><Input type="number" step="0.01" value={form.aliquota_cofins} onChange={e => setForm({ ...form, aliquota_cofins: e.target.value })} /></div>
              <div className="col-span-2"><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Label>Observações</Label><Textarea rows={2} value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeModal}><Ban className="w-4 h-4 mr-2" />Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending}><Save className="w-4 h-4 mr-2" />Salvar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}