import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const PERFIS = ['VENDEDOR', 'PROMOTOR', 'SUPERVISOR', 'GERENCIA'];
const TIPOS = ['TETO_VENCIDO', 'LIMITE_EXCELENCIA', 'PESO_FATURAMENTO', 'PESO_COBERTURA', 'PESO_MIX', 'PESO_QUALIDADE', 'PRECO_MEDIO_REF', 'TETO_SEGURANCA_FINANCEIRA'];
const STATUS_CLS = {
  ATIVA: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXPERIMENTAL: 'bg-amber-50 text-amber-700 border-amber-200',
  ENCERRADA: 'bg-slate-100 text-slate-500 border-slate-200'
};

// Gestão da tabela de metas parametrizável (decisão #1). Tetos/pesos nunca são hardcoded.
export default function GerenciarMetas() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    perfil: 'VENDEDOR', tipo_meta: 'PESO_FATURAMENTO', valor: '',
    curva_cliente: '', regiao_rota_id: '', segmento_cobertura: '',
    vigencia_inicio: new Date().toISOString().slice(0, 10), status: 'EXPERIMENTAL'
  });

  const { data: metas = [] } = useQuery({
    queryKey: ['metas-comissao'],
    queryFn: () => base44.entities.MetaComissao.list('-vigencia_inicio', 500)
  });
  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas-metas'],
    queryFn: () => base44.entities.Rota.list('-created_date', 1000)
  });
  const rotaNome = new Map(rotas.map(r => [r.id, r.nome]));

  const salvar = async () => {
    if (!form.valor) { toast.error('Informe o valor da meta'); return; }
    if (form.status === 'ATIVA') {
      const u = await base44.auth.me().catch(() => null);
      await base44.entities.MetaComissao.create({
        ...form, valor: Number(form.valor),
        aprovado_por_id: u?.id, aprovado_por_nome: u?.full_name, criado_por_id: u?.id, criado_por_nome: u?.full_name
      });
    } else {
      const u = await base44.auth.me().catch(() => null);
      await base44.entities.MetaComissao.create({ ...form, valor: Number(form.valor), criado_por_id: u?.id, criado_por_nome: u?.full_name });
    }
    toast.success('Meta cadastrada');
    setForm({ ...form, valor: '' });
    qc.invalidateQueries({ queryKey: ['metas-comissao'] });
  };

  const remover = async (id) => {
    await base44.entities.MetaComissao.delete(id);
    qc.invalidateQueries({ queryKey: ['metas-comissao'] });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-1">
        <CardHeader className="pb-3"><CardTitle className="text-base">Nova Meta</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Perfil</Label>
            <Select value={form.perfil} onValueChange={v => setForm({ ...form, perfil: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PERFIS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tipo de meta</Label>
            <Select value={form.tipo_meta} onValueChange={v => setForm({ ...form, tipo_meta: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Valor (% ou R$)</Label>
            <Input type="number" value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} placeholder="ex: 40" />
          </div>
          <div>
            <Label className="text-xs">Curva do cliente (opcional)</Label>
            <Input value={form.curva_cliente} onChange={e => setForm({ ...form, curva_cliente: e.target.value.toUpperCase() })} placeholder="A / B / C — vazio = todas" />
          </div>
          <div>
            <Label className="text-xs">Região/Rota (opcional)</Label>
            <Select value={form.regiao_rota_id || 'TODAS'} onValueChange={v => setForm({ ...form, regiao_rota_id: v === 'TODAS' ? '' : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas as regiões</SelectItem>
                {rotas.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Segmento (opcional)</Label>
            <Input value={form.segmento_cobertura} onChange={e => setForm({ ...form, segmento_cobertura: e.target.value.toUpperCase() })} placeholder="vazio = todos" />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EXPERIMENTAL">Experimental (calibração)</SelectItem>
                <SelectItem value="ATIVA">Ativa (pagamento real)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={salvar}><Plus className="w-4 h-4 mr-1" /> Cadastrar meta</Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3"><CardTitle className="text-base">Metas cadastradas ({metas.length})</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {metas.length === 0 && <p className="text-sm text-slate-400">Nenhuma meta cadastrada. Cadastre ao menos uma meta genérica por perfil/tipo (fallback final).</p>}
          {metas.map(m => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-700">{m.perfil}</span>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-xs text-slate-600">{m.tipo_meta}</span>
                  <Badge variant="outline" className={STATUS_CLS[m.status]}>{m.status}</Badge>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {[m.curva_cliente && `Curva ${m.curva_cliente}`, m.regiao_rota_id && (rotaNome.get(m.regiao_rota_id) || 'Rota'), m.segmento_cobertura].filter(Boolean).join(' / ') || 'Genérica (todos)'}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-bold text-slate-700">{m.valor}{m.tipo_meta === 'PRECO_MEDIO_REF' ? '' : '%'}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => remover(m.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}