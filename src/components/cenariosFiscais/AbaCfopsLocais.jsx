import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import CfopFormModal from './CfopFormModal';

const TIPO_COLOR = {
  venda: 'bg-green-100 text-green-700',
  devolucao: 'bg-red-100 text-red-700',
  remessa: 'bg-blue-100 text-blue-700',
  bonificacao: 'bg-purple-100 text-purple-700',
  troca: 'bg-amber-100 text-amber-700',
  transferencia: 'bg-indigo-100 text-indigo-700',
  outros: 'bg-slate-100 text-slate-700'
};

export default function AbaCfopsLocais({ naturezas = [] }) {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busca, setBusca] = useState('');

  const { data: cfops = [], isLoading } = useQuery({
    queryKey: ['cfopsLocais'],
    queryFn: () => base44.entities.ParametroNaturezaOperacao.list('-created_date', 200)
  });

  const saveMutation = useMutation({
    mutationFn: (data) => selected?.id
      ? base44.entities.ParametroNaturezaOperacao.update(selected.id, data)
      : base44.entities.ParametroNaturezaOperacao.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfopsLocais'] });
      toast.success(selected?.id ? 'CFOP atualizado' : 'CFOP criado');
      setModalOpen(false);
      setSelected(null);
    },
    onError: (e) => toast.error('Erro: ' + e.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ParametroNaturezaOperacao.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfopsLocais'] });
      toast.success('CFOP excluído');
      setDeleteOpen(false);
      setSelected(null);
    },
    onError: (e) => toast.error('Erro: ' + e.message)
  });

  const filtrados = cfops.filter(c =>
    !busca ||
    (c.cfop || '').includes(busca) ||
    (c.descricao || '').toLowerCase().includes(busca.toLowerCase()) ||
    (c.tipo_operacao || '').toLowerCase().includes(busca.toLowerCase())
  );

  const novo = () => { setSelected(null); setModalOpen(true); };
  const editar = (c) => { setSelected(c); setModalOpen(true); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
        <MapPin className="w-4 h-4 flex-shrink-0" />
        <span>
          <strong>Cadastro local — CRUD completo.</strong> Crie/edite/exclua CFOPs e Naturezas internas. Vincule opcionalmente a uma Natureza Omie para emissão.
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar CFOP, descrição ou tipo..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={novo} className="bg-gradient-to-r from-yellow-400 to-amber-500 text-neutral-900">
          <Plus className="w-4 h-4 mr-2" />Novo CFOP
        </Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3 text-xs font-semibold text-slate-600 w-24">CFOP</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Descrição</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Tipo</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">UF</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Natureza Omie</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Padrão</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Status</th>
              <th className="text-right p-3 text-xs font-semibold text-slate-600">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(c => {
              const natureza = naturezas.find(n => n.id === c.cenario_fiscal_id);
              return (
                <tr key={c.id} className="border-b hover:bg-slate-50">
                  <td className="p-3 text-sm font-mono font-semibold">{c.cfop}</td>
                  <td className="p-3 text-sm">{c.descricao || <span className="text-slate-400">—</span>}</td>
                  <td className="p-3">
                    <Badge className={TIPO_COLOR[c.tipo_operacao] || TIPO_COLOR.outros}>{c.tipo_operacao}</Badge>
                  </td>
                  <td className="p-3 text-xs text-slate-600">{c.dentro_estado ? 'Dentro' : 'Fora'}</td>
                  <td className="p-3 text-xs text-slate-600">
                    {natureza ? <span title={natureza.nome}>#{natureza.omie_id}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="p-3">{c.padrao ? <Badge className="bg-yellow-100 text-yellow-800">Sim</Badge> : <span className="text-slate-300">—</span>}</td>
                  <td className="p-3">
                    <Badge className={c.ativo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>
                      {c.ativo ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => editar(c)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => { setSelected(c); setDeleteOpen(true); }}>
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-slate-400">
                {isLoading ? 'Carregando...' : cfops.length === 0 ? 'Nenhum CFOP cadastrado — clique em "Novo CFOP"' : 'Nenhum resultado'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CfopFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        initial={selected}
        naturezas={naturezas}
        onSave={(data) => saveMutation.mutate(data)}
        saving={saveMutation.isPending}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
        title={`Excluir CFOP ${selected?.cfop}?`}
        description="Esta ação não pode ser desfeita. CFOPs em uso por pedidos não devem ser excluídos."
      />
    </div>
  );
}