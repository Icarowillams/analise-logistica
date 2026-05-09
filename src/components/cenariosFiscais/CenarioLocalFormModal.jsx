import React, { useEffect, useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Link2, Info } from 'lucide-react';

const TIPOS = [
  { value: 'venda', label: 'Venda' },
  { value: 'bonificacao', label: 'Bonificação' },
  { value: 'troca', label: 'Troca' },
  { value: 'devolucao', label: 'Devolução' },
  { value: 'remessa', label: 'Remessa' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'outros', label: 'Outros' }
];

export default function CenarioLocalFormModal({ open, onOpenChange, cenario, naturezasOmie, onSave, isSaving }) {
  const [form, setForm] = useState({
    nome: '',
    tipo_operacao: 'venda',
    descricao: '',
    cenario_omie_id: '',
    padrao: false,
    status: 'ativo',
    observacoes: ''
  });

  useEffect(() => {
    if (cenario) {
      setForm({
        nome: cenario.nome || '',
        tipo_operacao: cenario.tipo_operacao || 'venda',
        descricao: cenario.descricao || '',
        cenario_omie_id: cenario.cenario_omie_id || '',
        padrao: cenario.padrao || false,
        status: cenario.status || 'ativo',
        observacoes: cenario.observacoes || ''
      });
    } else {
      setForm({ nome: '', tipo_operacao: 'venda', descricao: '', cenario_omie_id: '', padrao: false, status: 'ativo', observacoes: '' });
    }
  }, [cenario, open]);

  const naturezasOrdenadas = useMemo(
    () => [...naturezasOmie].sort((a, b) => (a.nome || '').localeCompare(b.nome || '')),
    [naturezasOmie]
  );

  const handleSave = () => {
    if (!form.nome.trim()) return;
    const omie = naturezasOmie.find(n => n.id === form.cenario_omie_id);
    onSave({
      ...form,
      cenario_omie_nome: omie?.nome || '',
      cenario_omie_codigo: omie?.omie_id || ''
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{cenario ? 'Editar Cenário Local' : 'Novo Cenário Local'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nome *</Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Venda, Bonificação, Troca" />
            </div>
            <div>
              <Label>Tipo de Operação *</Label>
              <Select value={form.tipo_operacao} onValueChange={v => setForm({ ...form, tipo_operacao: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Descrição</Label>
            <Input value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} />
          </div>

          <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-900">
              <Link2 className="w-4 h-4" />
              Vínculo com Cenário Fiscal Omie (opcional)
            </div>
            <p className="text-xs text-blue-800 flex gap-1.5">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Usado apenas quando o cliente for <strong>Nota 55 (NF-e)</strong>. Para Nota D1, este cenário será interno e não envia ao Omie.
            </p>
            <Select
              value={form.cenario_omie_id || 'none'}
              onValueChange={v => setForm({ ...form, cenario_omie_id: v === 'none' ? '' : v })}
            >
              <SelectTrigger><SelectValue placeholder="Nenhum (apenas interno)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum (apenas interno)</SelectItem>
                {naturezasOrdenadas.map(n => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.nome} {n.omie_id ? `· ${n.omie_id}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="padrao" className="flex flex-col gap-0.5">
              <span>Cenário padrão</span>
              <span className="text-xs text-slate-500 font-normal">Marca como padrão para este tipo de operação</span>
            </Label>
            <Switch id="padrao" checked={form.padrao} onCheckedChange={v => setForm({ ...form, padrao: v })} />
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving || !form.nome.trim()} className="bg-amber-500 hover:bg-amber-600 text-neutral-900">
            {isSaving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}