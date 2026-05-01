import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeftRight, Search, Eye, Info } from 'lucide-react';

const STATUS = {
  aberto: { label: 'Aberto', color: 'bg-slate-100 text-slate-700' },
  em_analise: { label: 'Em Análise', color: 'bg-blue-100 text-blue-800' },
  aprovado: { label: 'Aprovado', color: 'bg-green-100 text-green-800' },
  recusado: { label: 'Recusado', color: 'bg-red-100 text-red-800' },
  finalizado: { label: 'Finalizado', color: 'bg-purple-100 text-purple-800' },
};

const TIPOS = { troca: 'Troca', devolucao: 'Devolução', bonificacao: 'Bonificação' };

export default function ControlePedidosTroca() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [detalhe, setDetalhe] = useState(null);

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['pedidosTroca'],
    queryFn: () => base44.entities.PedidoTroca.list('-data_troca', 500)
  });

  const { data: itens = [] } = useQuery({
    queryKey: ['itensTroca', detalhe?.id],
    queryFn: () => base44.entities.ItemPedidoTroca.filter({ pedido_troca_id: detalhe.id }),
    enabled: !!detalhe
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
      <PageHeader title="Pedidos de Troca" icon={ArrowLeftRight} subtitle="Visualização de trocas, devoluções e bonificações originadas do Omie" />

      <Card className="border-0 shadow-sm bg-blue-50/50">
        <CardContent className="p-3 flex items-start gap-2 text-sm">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <p className="text-blue-900">
            <strong>Trocas/Devoluções vêm do Omie.</strong> A criação manual foi desativada — devoluções devem ser registradas no fluxo de Ajustes ou diretamente no Omie.
          </p>
        </CardContent>
      </Card>

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
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDetalhe(p)}><Eye className="w-3 h-3 mr-1" />Ver</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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