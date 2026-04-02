import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Filter } from 'lucide-react';
import { toast } from 'sonner';

const MOTIVOS = [
  'Fora de horário de recebimento',
  'Cliente ausente',
  'Produto com defeito',
  'Produto vencido',
  'Pedido cancelado',
  'Endereço não encontrado',
  'Recusa do cliente',
  'Outro',
];

const FORM_INICIAL = {
  carga_id: '', numero_nf: '', data_retorno: new Date().toISOString().split('T')[0],
  horario_retorno: new Date().toTimeString().slice(0, 5),
  cliente_nome: '', motorista_id: '', motorista_nome: '',
  valor_retorno: '', motivo_descricao: '', observacoes: ''
};

export default function ControleRetornos() {
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const qc = useQueryClient();

  const { data: retornos = [] } = useQuery({
    queryKey: ['retornos'],
    queryFn: () => base44.entities.Retorno.list('-data_retorno', 500)
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const motoristas = vendedores.filter(v => (v.papeis || []).includes('motorista') || v.cnh_numero);

  const salvar = useMutation({
    mutationFn: (data) => {
      const payload = { ...data, numero_retorno: editando?.numero_retorno || `RET-${Date.now()}` };
      return editando ? base44.entities.Retorno.update(editando.id, payload) : base44.entities.Retorno.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries(['retornos']);
      setModalAberto(false);
      setEditando(null);
      setForm(FORM_INICIAL);
      toast.success(editando ? 'Retorno atualizado!' : 'Retorno registrado!');
    }
  });

  const excluir = useMutation({
    mutationFn: (id) => base44.entities.Retorno.delete(id),
    onSuccess: () => { qc.invalidateQueries(['retornos']); toast.success('Retorno excluído!'); }
  });

  const abrirEditar = (r) => {
    setEditando(r);
    setForm({ ...r });
    setModalAberto(true);
  };

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setModalAberto(true);
  };

  const handleMotorista = (id) => {
    const m = motoristas.find(v => v.id === id);
    setForm(p => ({ ...p, motorista_id: id, motorista_nome: m?.nome || '' }));
  };

  const retornosFiltrados = retornos.filter(r => {
    if (dataInicio && r.data_retorno < dataInicio) return false;
    if (dataFim && r.data_retorno > dataFim) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Retornos</h1>
          <p className="text-sm text-slate-500">Gerencie os retornos de produtos</p>
        </div>
        <Button onClick={abrirNovo} className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus className="w-4 h-4 mr-1" /> Novo Retorno
        </Button>
      </div>

      {/* Filtros */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Filter className="w-4 h-4" /> Filtros de Período</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Label className="text-xs text-slate-500">Data Início</Label>
              <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="h-9 mt-1" />
            </div>
            <div className="flex-1">
              <Label className="text-xs text-slate-500">Data Fim</Label>
              <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className="h-9 mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Data</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Horário</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">NF Retorno</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Motorista</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Valor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Observação</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {retornosFiltrados.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400 text-sm">Nenhum retorno encontrado.</td></tr>
              ) : retornosFiltrados.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-700">{r.data_retorno ? new Date(r.data_retorno + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.horario_retorno || '—'}</td>
                  <td className="px-4 py-3 font-medium">{r.numero_nf || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{r.cliente_nome || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.motorista_nome ? `${r.motorista_nome} →` : '—'}</td>
                  <td className="px-4 py-3">
                    {r.valor_retorno > 0
                      ? <span className="font-semibold text-orange-600">R$ {Number(r.valor_retorno).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 max-w-[180px] truncate">{r.motivo_descricao || r.observacoes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => abrirEditar(r)} className="p-1.5 rounded hover:bg-blue-50 text-blue-500 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { if (confirm('Excluir retorno?')) excluir.mutate(r.id); }} className="p-1.5 rounded hover:bg-red-50 text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal */}
      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editando ? 'Editar Retorno' : 'Novo Retorno'}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-xs text-slate-600">Carga Relacionada</Label>
              <Input placeholder="Digite o número ou identificação da carga" value={form.carga_id} onChange={e => setForm(p => ({ ...p, carga_id: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-600">NF de Retorno</Label>
                <Input value={form.numero_nf} onChange={e => setForm(p => ({ ...p, numero_nf: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-slate-600">Data do Retorno *</Label>
                <Input type="date" value={form.data_retorno} onChange={e => setForm(p => ({ ...p, data_retorno: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-600">Horário do Retorno</Label>
              <Input type="time" value={form.horario_retorno} onChange={e => setForm(p => ({ ...p, horario_retorno: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-600">Nome do Cliente</Label>
                <Input placeholder="Nome fantasia do cliente" value={form.cliente_nome} onChange={e => setForm(p => ({ ...p, cliente_nome: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-slate-600">Motorista</Label>
                <Select value={form.motorista_id} onValueChange={handleMotorista}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecione o motorista" /></SelectTrigger>
                  <SelectContent>
                    {motoristas.map(m => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-600">Valor do Retorno (R$)</Label>
              <Input type="number" step="0.01" value={form.valor_retorno} onChange={e => setForm(p => ({ ...p, valor_retorno: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Motivo do Retorno *</Label>
              <Select value={form.motivo_descricao} onValueChange={v => setForm(p => ({ ...p, motivo_descricao: v }))}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
                <SelectContent>
                  {MOTIVOS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-600">Observação</Label>
              <Textarea placeholder="Descreva os detalhes do retorno..." value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={3} className="mt-1" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setModalAberto(false)}>Cancelar</Button>
              <Button className="flex-1 bg-orange-500 hover:bg-orange-600 text-white" onClick={() => salvar.mutate(form)} disabled={salvar.isPending}>
                {editando ? 'Salvar Alterações' : 'Registrar Retorno'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}