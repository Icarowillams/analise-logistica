import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeftRight, Plus, Search, Eye, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const STATUS = {
  aberto: { label: 'Aberto', color: 'bg-slate-100 text-slate-700' },
  em_analise: { label: 'Em Análise', color: 'bg-blue-100 text-blue-800' },
  aprovado: { label: 'Aprovado', color: 'bg-green-100 text-green-800' },
  recusado: { label: 'Recusado', color: 'bg-red-100 text-red-800' },
  finalizado: { label: 'Finalizado', color: 'bg-purple-100 text-purple-800' },
};

const TIPOS = { troca: 'Troca', devolucao: 'Devolução', bonificacao: 'Bonificação' };

const FORM_INIT = { numero_troca: '', data_troca: new Date().toISOString().split('T')[0], tipo: 'troca', cliente_id: '', cliente_nome: '', vendedor_id: '', vendedor_nome: '', motivo_descricao: '', observacoes: '', status: 'aberto' };

export default function ControlePedidosTroca() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [detalhe, setDetalhe] = useState(null);
  const qc = useQueryClient();

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['pedidosTroca'],
    queryFn: () => base44.entities.PedidoTroca.list('-data_troca', 500)
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 3000)
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: motivos = [] } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
  });

  const { data: itens = [] } = useQuery({
    queryKey: ['itensTroca', detalhe?.id],
    queryFn: () => base44.entities.ItemPedidoTroca.filter({ pedido_troca_id: detalhe.id }),
    enabled: !!detalhe
  });

  const criar = useMutation({
    mutationFn: (data) => base44.entities.PedidoTroca.create(data),
    onSuccess: () => { qc.invalidateQueries(['pedidosTroca']); setModal(false); setForm(FORM_INIT); toast.success('Pedido de troca criado!'); }
  });

  const aprovar = useMutation({
    mutationFn: (id) => base44.entities.PedidoTroca.update(id, { status: 'aprovado', data_aprovacao: new Date().toISOString().split('T')[0] }),
    onSuccess: () => { qc.invalidateQueries(['pedidosTroca']); toast.success('Troca aprovada!'); }
  });

  const recusar = useMutation({
    mutationFn: (id) => base44.entities.PedidoTroca.update(id, { status: 'recusado' }),
    onSuccess: () => { qc.invalidateQueries(['pedidosTroca']); toast.success('Troca recusada.'); }
  });

  const filtrados = pedidos.filter(p => {
    if (filtroStatus && p.status !== filtroStatus) return false;
    if (busca) {
      const t = busca.toLowerCase();
      return p.numero_troca?.toLowerCase().includes(t) || p.cliente_nome?.toLowerCase().includes(t) || p.motivo_descricao?.toLowerCase().includes(t);
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Pedidos de Troca" icon={ArrowLeftRight} subtitle="Gerenciamento de trocas, devoluções e bonificações" />

      {/* Status cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {Object.entries(STATUS).map(([k, v]) => (
          <Card key={k} className={`border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow ${filtroStatus === k ? 'ring-2 ring-amber-400' : ''}`} onClick={() => setFiltroStatus(filtroStatus === k ? '' : k)}>
            <CardContent className="p-3 text-center">
              <div className="text-xl font-bold text-slate-700">{pedidos.filter(p => p.status === k).length}</div>
              <Badge className={`text-xs mt-1 ${v.color}`}>{v.label}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-end">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar troca, cliente, motivo..." className="pl-8 h-9" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <Select value={filtroStatus} onValueChange={v => setFiltroStatus(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="btn-pao-mel h-9" onClick={() => setModal(true)}><Plus className="w-4 h-4 mr-1" />Nova Troca</Button>
      </div>

      {isLoading ? <p className="text-center py-10 text-slate-500">Carregando...</p> : (
        <div className="space-y-2">
          {filtrados.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-slate-500">Nenhuma troca encontrada.</CardContent></Card>
          ) : filtrados.map(p => {
            const st = STATUS[p.status] || STATUS.aberto;
            return (
              <Card key={p.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <ArrowLeftRight className="w-4 h-4 text-orange-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-slate-800">{p.numero_troca} <span className="text-xs font-normal text-slate-500">({TIPOS[p.tipo] || p.tipo})</span></div>
                        <div className="text-xs text-slate-500">{p.cliente_nome} · {p.vendedor_nome}</div>
                        <div className="text-xs text-slate-400">{p.data_troca && new Date(p.data_troca + 'T12:00:00').toLocaleDateString('pt-BR')} {p.motivo_descricao && `· ${p.motivo_descricao}`}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {p.valor_total > 0 && <span className="text-sm font-semibold text-slate-700">R$ {p.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                      <Badge className={`text-xs ${st.color}`}>{st.label}</Badge>
                      {p.status === 'aberto' || p.status === 'em_analise' ? (
                        <>
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-green-600 hover:text-green-700" onClick={() => aprovar.mutate(p.id)}><CheckCircle className="w-3 h-3 mr-1" />Aprovar</Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600 hover:text-red-700" onClick={() => recusar.mutate(p.id)}><XCircle className="w-3 h-3 mr-1" />Recusar</Button>
                        </>
                      ) : null}
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDetalhe(p)}><Eye className="w-3 h-3 mr-1" />Ver</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nova Troca / Devolução</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Número</Label><Input value={form.numero_troca} onChange={e => setForm({ ...form, numero_troca: e.target.value })} className="h-9" /></div>
              <div><Label className="text-xs">Data</Label><Input type="date" value={form.data_troca} onChange={e => setForm({ ...form, data_troca: e.target.value })} className="h-9" /></div>
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TIPOS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Cliente</Label>
              <Select value={form.cliente_id || ''} onValueChange={v => { const c = clientes.find(x => x.id === v); setForm({ ...form, cliente_id: v, cliente_nome: c?.nome_fantasia || c?.razao_social || '' }); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{clientes.slice(0, 100).map(c => <SelectItem key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Vendedor</Label>
                <Select value={form.vendedor_id || ''} onValueChange={v => { const ve = vendedores.find(x => x.id === v); setForm({ ...form, vendedor_id: v, vendedor_nome: ve?.nome || '' }); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Motivo</Label>
                <Select value={form.motivo_id || ''} onValueChange={v => { const m = motivos.find(x => x.id === v); setForm({ ...form, motivo_id: v, motivo_descricao: m?.descricao || m?.nome || '' }); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{motivos.map(m => <SelectItem key={m.id} value={m.id}>{m.descricao || m.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Observações</Label><Textarea value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} rows={2} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
              <Button className="btn-pao-mel" onClick={() => criar.mutate(form)} disabled={!form.numero_troca || !form.cliente_id}>Criar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detalhe} onOpenChange={() => setDetalhe(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Troca {detalhe?.numero_troca}</DialogTitle></DialogHeader>
          {detalhe && (
            <div className="space-y-3 mt-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-500">Cliente:</span> <span className="font-medium">{detalhe.cliente_nome}</span></div>
                <div><span className="text-slate-500">Tipo:</span> <span className="font-medium">{TIPOS[detalhe.tipo]}</span></div>
                <div><span className="text-slate-500">Motivo:</span> <span className="font-medium">{detalhe.motivo_descricao || '-'}</span></div>
                <div><span className="text-slate-500">Vendedor:</span> <span className="font-medium">{detalhe.vendedor_nome}</span></div>
              </div>
              {itens.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-700 mb-2">Itens</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {itens.map(item => (
                      <div key={item.id} className="flex justify-between items-center p-2 bg-slate-50 rounded text-xs">
                        <span>{item.produto_nome}</span>
                        <span className="text-slate-500">{item.quantidade} {item.unidade_medida}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detalhe.observacoes && <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded">{detalhe.observacoes}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}