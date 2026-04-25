import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Save, Ban } from 'lucide-react';

const empty = {
  cfop: '', descricao: '', tipo_operacao: 'venda',
  dentro_estado: true, codigo_cenario_impostos: '',
  cenario_fiscal_id: '', padrao: false, ativo: true, observacoes: ''
};

export default function CfopFormModal({ open, onOpenChange, onSave, initial, naturezas = [], saving }) {
  const [form, setForm] = React.useState(empty);

  React.useEffect(() => {
    if (open) setForm(initial ? { ...empty, ...initial } : empty);
  }, [open, initial]);

  const submit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Editar CFOP' : 'Novo CFOP / Natureza Local'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>CFOP *</Label>
              <Input required maxLength={4} value={form.cfop} onChange={e => setForm({ ...form, cfop: e.target.value })} placeholder="Ex: 5102" />
            </div>
            <div>
              <Label>Tipo de Operação *</Label>
              <Select value={form.tipo_operacao} onValueChange={v => setForm({ ...form, tipo_operacao: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="venda">Venda</SelectItem>
                  <SelectItem value="devolucao">Devolução</SelectItem>
                  <SelectItem value="remessa">Remessa</SelectItem>
                  <SelectItem value="bonificacao">Bonificação</SelectItem>
                  <SelectItem value="troca">Troca</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="outros">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Descrição</Label>
              <Input value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} placeholder="Ex: Venda de mercadoria adquirida" />
            </div>
            <div className="col-span-2">
              <Label>Natureza Omie vinculada (opcional)</Label>
              <Select value={form.cenario_fiscal_id || 'none'} onValueChange={v => {
                if (v === 'none') {
                  setForm({ ...form, cenario_fiscal_id: '', codigo_cenario_impostos: '' });
                } else {
                  const n = naturezas.find(x => x.id === v);
                  setForm({ ...form, cenario_fiscal_id: v, codigo_cenario_impostos: n?.omie_id || '' });
                }
              }}>
                <SelectTrigger><SelectValue placeholder="Selecione uma natureza Omie" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nenhuma —</SelectItem>
                  {naturezas.map(n => (
                    <SelectItem key={n.id} value={n.id}>{n.nome} (#{n.omie_id})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <Label className="cursor-pointer">Dentro do estado (CFOP 5xxx)</Label>
              <Switch checked={form.dentro_estado} onCheckedChange={v => setForm({ ...form, dentro_estado: v })} />
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <Label className="cursor-pointer">CFOP padrão para este tipo</Label>
              <Switch checked={form.padrao} onCheckedChange={v => setForm({ ...form, padrao: v })} />
            </div>
            <div className="col-span-2 flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <Label className="cursor-pointer">Ativo</Label>
              <Switch checked={form.ativo} onCheckedChange={v => setForm({ ...form, ativo: v })} />
            </div>
            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              <Ban className="w-4 h-4 mr-2" />Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}