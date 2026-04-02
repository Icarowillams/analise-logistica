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
import { ShoppingCart, Plus, Search, Eye, FileText } from 'lucide-react';
import { toast } from 'sonner';

const STATUS = {
  rascunho: { label: 'Rascunho', color: 'bg-slate-100 text-slate-700' },
  confirmado: { label: 'Confirmado', color: 'bg-blue-100 text-blue-800' },
  faturado: { label: 'Faturado', color: 'bg-purple-100 text-purple-800' },
  em_rota: { label: 'Em Rota', color: 'bg-orange-100 text-orange-800' },
  entregue: { label: 'Entregue', color: 'bg-green-100 text-green-800' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
  devolvido: { label: 'Devolvido', color: 'bg-yellow-100 text-yellow-800' },
};

const FORM_INIT = { numero_pedido: '', data_pedido: new Date().toISOString().split('T')[0], cliente_id: '', cliente_nome: '', vendedor_id: '', vendedor_nome: '', plano_pagamento_nome: '', observacoes: '', status: 'rascunho' };

export default function ControlePedidosVenda() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroVendedor, setFiltroVendedor] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [pedidoDetalhe, setPedidoDetalhe] = useState(null);
  const qc = useQueryClient();

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['pedidosVenda'],
    queryFn: () => base44.entities.PedidoVenda.list('-data_pedido', 500)
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 3000)
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: planos = [] } = useQuery({
    queryKey: ['planosPagamento'],
    queryFn: () => base44.entities.PlanoPagamento.list()
  });

  const { data: itensPedido = [] } = useQuery({
    queryKey: ['itensPedidoVenda', pedidoDetalhe?.id],
    queryFn: () => base44.entities.ItemPedidoVenda.filter({ pedido_venda_id: pedidoDetalhe.id }),
    enabled: !!pedidoDetalhe
  });

  const criar = useMutation({
    mutationFn: (data) => base44.entities.PedidoVenda.create(data),
    onSuccess: () => { qc.invalidateQueries(['pedidosVenda']); setModal(false); setForm(FORM_INIT); toast.success('Pedido criado!'); }
  });

  const atualizarStatus = useMutation({
    mutationFn: ({ id, status }) => base44.entities.PedidoVenda.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries(['pedidosVenda']); toast.success('Status atualizado!'); }
  });

  const pedidosFiltrados = pedidos.filter(p => {
    if (filtroStatus && p.status !== filtroStatus) return false;
    if (filtroVendedor && p.vendedor_id !== filtroVendedor) return false;
    if (busca) {
      const t = busca.toLowerCase();
      return p.numero_pedido?.toLowerCase().includes(t) || p.cliente_nome?.toLowerCase().includes(t) || p.numero_nota_fiscal?.toLowerCase().includes(t);
    }
    return true;
  });

  const totais = pedidosFiltrados.reduce((acc, p) => ({ valor: acc.valor + (p.valor_total || 0), qtd: acc.qtd + 1 }), { valor: 0, qtd: 0 });

  return (
    <div className="space-y-4">
      <PageHeader title="Pedidos de Venda" icon={ShoppingCart} subtitle="Controle completo dos pedidos de venda" />

      {/* Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(STATUS).map(([k, v]) => {
          const qtd = pedidos.filter(p => p.status === k).length;
          return (
            <Card key={k} className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFiltroStatus(filtroStatus === k ? '' : k)}>
              <CardContent className="p-3 text-center">
                <div className="text-xl font-bold text-slate-700">{qtd}</div>
                <Badge className={`text-xs mt-1 ${v.color}`}>{v.label}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2 items-end">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar pedido, cliente, NF..." className="pl-8 h-9" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <Select value={filtroStatus} onValueChange={v => setFiltroStatus(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroVendedor} onValueChange={v => setFiltroVendedor(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Vendedor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            {vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="btn-pao-mel h-9" onClick={() => setModal(true)}><Plus className="w-4 h-4 mr-1" />Novo Pedido</Button>
      </div>

      <div className="text-sm text-slate-500">{totais.qtd} pedido(s) · R$ {totais.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>

      {isLoading ? <p className="text-center py-10 text-slate-500">Carregando...</p> : (
        <div className="space-y-2">
          {pedidosFiltrados.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-slate-500">Nenhum pedido encontrado.</CardContent></Card>
          ) : pedidosFiltrados.map(p => {
            const st = STATUS[p.status] || STATUS.rascunho;
            return (
              <Card key={p.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <ShoppingCart className="w-4 h-4 text-amber-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-slate-800">{p.numero_pedido} {p.numero_nota_fiscal && <span className="text-slate-500 font-normal">· NF: {p.numero_nota_fiscal}</span>}</div>
                        <div className="text-xs text-slate-500">{p.cliente_nome} · {p.vendedor_nome}</div>
                        <div className="text-xs text-slate-400">{p.data_pedido && new Date(p.data_pedido + 'T12:00:00').toLocaleDateString('pt-BR')} · {p.plano_pagamento_nome}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {p.valor_total > 0 && <span className="text-sm font-semibold text-slate-700">R$ {p.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                      <Badge className={`text-xs ${st.color}`}>{st.label}</Badge>
                      <Select value={p.status} onValueChange={v => atualizarStatus.mutate({ id: p.id, status: v })}>
                        <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPedidoDetalhe(p)}><Eye className="w-3 h-3 mr-1" />Ver</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal Novo Pedido */}
      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Novo Pedido de Venda</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Número do Pedido</Label><Input value={form.numero_pedido} onChange={e => setForm({ ...form, numero_pedido: e.target.value })} className="h-9" /></div>
              <div><Label className="text-xs">Data do Pedido</Label><Input type="date" value={form.data_pedido} onChange={e => setForm({ ...form, data_pedido: e.target.value })} className="h-9" /></div>
            </div>
            <div>
              <Label className="text-xs">Cliente</Label>
              <Select value={form.cliente_id || ''} onValueChange={v => { const c = clientes.find(x => x.id === v); setForm({ ...form, cliente_id: v, cliente_nome: c?.nome_fantasia || c?.razao_social || '' }); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                <SelectContent>{clientes.slice(0, 100).map(c => <SelectItem key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Vendedor</Label>
                <Select value={form.vendedor_id || ''} onValueChange={v => { const vend = vendedores.find(x => x.id === v); setForm({ ...form, vendedor_id: v, vendedor_nome: vend?.nome || '' }); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Plano de Pagamento</Label>
                <Select value={form.plano_pagamento_id || ''} onValueChange={v => { const pl = planos.find(x => x.id === v); setForm({ ...form, plano_pagamento_id: v, plano_pagamento_nome: pl?.nome || '' }); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{planos.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Observações</Label><Textarea value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} rows={2} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
              <Button className="btn-pao-mel" onClick={() => criar.mutate(form)} disabled={!form.numero_pedido || !form.cliente_id}>Criar Pedido</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhe */}
      <Dialog open={!!pedidoDetalhe} onOpenChange={() => setPedidoDetalhe(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Pedido {pedidoDetalhe?.numero_pedido}</DialogTitle></DialogHeader>
          {pedidoDetalhe && (
            <div className="space-y-3 mt-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-500">Cliente:</span> <span className="font-medium">{pedidoDetalhe.cliente_nome}</span></div>
                <div><span className="text-slate-500">Vendedor:</span> <span className="font-medium">{pedidoDetalhe.vendedor_nome}</span></div>
                <div><span className="text-slate-500">Data:</span> <span className="font-medium">{pedidoDetalhe.data_pedido && new Date(pedidoDetalhe.data_pedido + 'T12:00:00').toLocaleDateString('pt-BR')}</span></div>
                <div><span className="text-slate-500">Pagamento:</span> <span className="font-medium">{pedidoDetalhe.plano_pagamento_nome}</span></div>
                <div><span className="text-slate-500">Valor Total:</span> <span className="font-bold text-slate-800">R$ {(pedidoDetalhe.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
                <div><span className="text-slate-500">NF:</span> <span className="font-medium">{pedidoDetalhe.numero_nota_fiscal || '-'}</span></div>
              </div>
              {itensPedido.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-700 mb-2">Itens do Pedido</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {itensPedido.map(item => (
                      <div key={item.id} className="flex justify-between items-center p-2 bg-slate-50 rounded text-xs">
                        <span>{item.produto_nome}</span>
                        <span className="text-slate-500">{item.quantidade} {item.unidade_medida} · R$ {(item.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {pedidoDetalhe.observacoes && <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded">{pedidoDetalhe.observacoes}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}