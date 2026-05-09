import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Trash2, Link2, Unlink, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import CenarioLocalFormModal from './CenarioLocalFormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';

const TIPO_LABELS = {
  venda: 'Venda',
  bonificacao: 'Bonificação',
  troca: 'Troca',
  devolucao: 'Devolução',
  remessa: 'Remessa',
  transferencia: 'Transferência',
  outros: 'Outros'
};

const TIPO_COLORS = {
  venda: 'bg-green-100 text-green-700',
  bonificacao: 'bg-blue-100 text-blue-700',
  troca: 'bg-orange-100 text-orange-700',
  devolucao: 'bg-red-100 text-red-700',
  remessa: 'bg-purple-100 text-purple-700',
  transferencia: 'bg-slate-100 text-slate-700',
  outros: 'bg-gray-100 text-gray-700'
};

export default function AbaCenariosLocais({ naturezasOmie }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const { data: cenarios = [], isLoading } = useQuery({
    queryKey: ['cenariosFiscaisLocais'],
    queryFn: () => base44.entities.CenarioFiscalLocal.list('-created_date', 500)
  });

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase();
    return cenarios.filter(c =>
      !q ||
      (c.nome || '').toLowerCase().includes(q) ||
      (c.tipo_operacao || '').toLowerCase().includes(q) ||
      (c.cenario_omie_nome || '').toLowerCase().includes(q)
    );
  }, [cenarios, busca]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editing?.id) return base44.entities.CenarioFiscalLocal.update(editing.id, data);
      return base44.entities.CenarioFiscalLocal.create(data);
    },
    onSuccess: () => {
      toast.success(editing ? 'Cenário atualizado' : 'Cenário criado');
      qc.invalidateQueries({ queryKey: ['cenariosFiscaisLocais'] });
      setModalOpen(false);
      setEditing(null);
    },
    onError: (e) => toast.error(e.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CenarioFiscalLocal.delete(id),
    onSuccess: () => {
      toast.success('Cenário excluído');
      qc.invalidateQueries({ queryKey: ['cenariosFiscaisLocais'] });
      setDeleteOpen(false);
      setToDelete(null);
    },
    onError: (e) => toast.error(e.message)
  });

  const handleNew = () => { setEditing(null); setModalOpen(true); };
  const handleEdit = (c) => { setEditing(c); setModalOpen(true); };
  const handleDelete = (c) => { setToDelete(c); setDeleteOpen(true); };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <strong>Cenários locais (cadastrados no Base).</strong> Use para tipificar operações como Venda, Bonificação, Troca etc.
          Quando o cliente for <strong>Nota 55 (NF-e)</strong>, o cenário pode ser vinculado a uma natureza do Omie.
          Para <strong>Nota D1</strong>, a operação é apenas interna — nunca envia ao Omie.
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome, tipo ou cenário Omie..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={handleNew} className="bg-amber-500 hover:bg-amber-600 text-neutral-900">
          <Plus className="w-4 h-4 mr-2" />Novo Cenário
        </Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Nome</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Tipo</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Vínculo Omie (Nota 55)</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Padrão</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Status</th>
              <th className="text-right p-3 text-xs font-semibold text-slate-600">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">Carregando...</td></tr>
            ) : filtrados.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">
                {cenarios.length === 0 ? 'Nenhum cenário local cadastrado — clique em "Novo Cenário"' : 'Nenhum resultado'}
              </td></tr>
            ) : filtrados.map(c => (
              <tr key={c.id} className="border-b hover:bg-slate-50">
                <td className="p-3 text-sm font-medium">{c.nome}</td>
                <td className="p-3">
                  <Badge className={TIPO_COLORS[c.tipo_operacao] || TIPO_COLORS.outros}>
                    {TIPO_LABELS[c.tipo_operacao] || c.tipo_operacao}
                  </Badge>
                </td>
                <td className="p-3 text-xs">
                  {c.cenario_omie_id ? (
                    <span className="inline-flex items-center gap-1.5 text-blue-700">
                      <Link2 className="w-3.5 h-3.5" />
                      {c.cenario_omie_nome || '-'} {c.cenario_omie_codigo ? <span className="text-slate-400 font-mono">· {c.cenario_omie_codigo}</span> : null}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-slate-400">
                      <Unlink className="w-3.5 h-3.5" />
                      Sem vínculo (apenas interno)
                    </span>
                  )}
                </td>
                <td className="p-3">
                  {c.padrao ? <Badge className="bg-yellow-100 text-yellow-800">Padrão</Badge> : <span className="text-slate-300">-</span>}
                </td>
                <td className="p-3">
                  <Badge className={c.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>
                    {c.status}
                  </Badge>
                </td>
                <td className="p-3 text-right">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(c)}><Pencil className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(c)} className="text-red-600 hover:text-red-700">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CenarioLocalFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        cenario={editing}
        naturezasOmie={naturezasOmie}
        onSave={(data) => saveMutation.mutate(data)}
        isSaving={saveMutation.isPending}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(toDelete?.id)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}