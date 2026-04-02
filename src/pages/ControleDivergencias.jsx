import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Search, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

const TIPO_CORES = { sobra_produto: 'bg-green-100 text-green-700', falta_produto: 'bg-red-100 text-red-700', diferenca_valor: 'bg-yellow-100 text-yellow-700', produto_errado: 'bg-orange-100 text-orange-700', pagamento: 'bg-purple-100 text-purple-700' };
const FORM_INICIAL = { motorista_nome: '', cliente_nome: '', produto_nome: '', quantidade_esperada: '', quantidade_real: '', valor_esperado: '', valor_real: '', tipo: 'falta_produto', data: new Date().toISOString().split('T')[0], observacoes: '' };

export default function ControleDivergencias() {
  const [busca, setBusca] = useState('');
  const [filtroResolvido, setFiltroResolvido] = useState('pendente');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const qc = useQueryClient();

  const { data: divergencias = [] } = useQuery({
    queryKey: ['divergencias'],
    queryFn: () => base44.entities.Divergencia.list('-data', 200)
  });

  const criar = useMutation({
    mutationFn: (data) => base44.entities.Divergencia.create({ ...data, numero_divergencia: `DIV-${Date.now()}`, resolvido: false }),
    onSuccess: () => { qc.invalidateQueries(['divergencias']); setModalAberto(false); setForm(FORM_INICIAL); toast.success('Divergência registrada!'); }
  });

  const resolver = useMutation({
    mutationFn: (id) => base44.entities.Divergencia.update(id, { resolvido: true, data_resolucao: new Date().toISOString().split('T')[0] }),
    onSuccess: () => { qc.invalidateQueries(['divergencias']); toast.success('Divergência resolvida!'); }
  });

  const filtradas = divergencias.filter(d => {
    const matchBusca = !busca || d.motorista_nome?.toLowerCase().includes(busca.toLowerCase()) || d.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) || d.produto_nome?.toLowerCase().includes(busca.toLowerCase());
    const matchStatus = filtroResolvido === 'todos' || (filtroResolvido === 'pendente' ? !d.resolvido : d.resolvido);
    return matchBusca && matchStatus;
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Divergências" icon={AlertTriangle} subtitle="Diferenças de produto e valor" action={() => setModalAberto(true)} actionLabel="Nova Divergência" />

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-8 h-9" />
        </div>
        <Select value={filtroResolvido} onValueChange={setFiltroResolvido}>
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="resolvido">Resolvidas</SelectItem>
            <SelectItem value="todos">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {filtradas.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-slate-500 text-sm">Nenhuma divergência encontrada.</CardContent></Card>
        ) : filtradas.map(d => (
          <Card key={d.id} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className={TIPO_CORES[d.tipo] || 'bg-slate-100'}>{d.tipo?.replace('_', ' ')}</Badge>
                    {d.resolvido && <Badge className="bg-green-100 text-green-700">Resolvida</Badge>}
                  </div>
                  <div className="font-medium text-sm mt-1">{d.produto_nome || '—'}</div>
                  <div className="text-xs text-slate-500">{d.motorista_nome} · {d.cliente_nome}</div>
                  {(d.quantidade_esperada || d.quantidade_real) && (
                    <div className="text-xs text-slate-400 mt-1">Esperado: {d.quantidade_esperada} · Real: {d.quantidade_real}</div>
                  )}
                </div>
                {!d.resolvido && (
                  <Button size="sm" variant="outline" onClick={() => resolver.mutate(d.id)} className="h-7 text-xs">
                    <CheckCircle className="w-3 h-3 mr-1" />Resolver
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Divergência</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Data</Label><Input type="date" value={form.data} onChange={e => setForm(p => ({ ...p, data: e.target.value }))} /></div>
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={form.tipo} onValueChange={v => setForm(p => ({ ...p, tipo: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="falta_produto">Falta Produto</SelectItem>
                    <SelectItem value="sobra_produto">Sobra Produto</SelectItem>
                    <SelectItem value="diferenca_valor">Diferença Valor</SelectItem>
                    <SelectItem value="produto_errado">Produto Errado</SelectItem>
                    <SelectItem value="pagamento">Pagamento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Motorista</Label><Input value={form.motorista_nome} onChange={e => setForm(p => ({ ...p, motorista_nome: e.target.value }))} /></div>
            <div><Label className="text-xs">Cliente</Label><Input value={form.cliente_nome} onChange={e => setForm(p => ({ ...p, cliente_nome: e.target.value }))} /></div>
            <div><Label className="text-xs">Produto</Label><Input value={form.produto_nome} onChange={e => setForm(p => ({ ...p, produto_nome: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Qtd Esperada</Label><Input type="number" value={form.quantidade_esperada} onChange={e => setForm(p => ({ ...p, quantidade_esperada: e.target.value }))} /></div>
              <div><Label className="text-xs">Qtd Real</Label><Input type="number" value={form.quantidade_real} onChange={e => setForm(p => ({ ...p, quantidade_real: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Observações</Label><Textarea value={form.observacoes} onChange={e => setForm(p => ({ ...p, observacoes: e.target.value }))} rows={2} /></div>
            <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white" onClick={() => criar.mutate(form)} disabled={criar.isPending}>Registrar Divergência</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}