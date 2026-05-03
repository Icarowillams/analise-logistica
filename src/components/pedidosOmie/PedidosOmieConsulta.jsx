import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowLeftRight, Eye, Search, ShoppingCart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const statusVenda = {
  rascunho: { label: 'Rascunho', color: 'bg-slate-100 text-slate-700' },
  confirmado: { label: 'Confirmado', color: 'bg-blue-100 text-blue-800' },
  faturado: { label: 'Faturado', color: 'bg-purple-100 text-purple-800' },
  em_rota: { label: 'Em Rota', color: 'bg-orange-100 text-orange-800' },
  entregue: { label: 'Entregue', color: 'bg-green-100 text-green-800' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
  devolvido: { label: 'Devolvido', color: 'bg-yellow-100 text-yellow-800' },
};

const statusTroca = {
  aberto: { label: 'Aberto', color: 'bg-slate-100 text-slate-700' },
  em_analise: { label: 'Em Análise', color: 'bg-blue-100 text-blue-800' },
  aprovado: { label: 'Aprovado', color: 'bg-green-100 text-green-800' },
  recusado: { label: 'Recusado', color: 'bg-red-100 text-red-800' },
  finalizado: { label: 'Finalizado', color: 'bg-purple-100 text-purple-800' },
};

const tiposTroca = { troca: 'Troca', devolucao: 'Devolução', bonificacao: 'Bonificação' };

const formatarData = (data) => data ? new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR') : '-';
const formatarMoeda = (valor) => (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PedidosOmieConsulta() {
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('todos');
  const [detalhe, setDetalhe] = useState(null);

  const buscarPedidosOmiePorEtapas = async () => {
    const etapas = ['10', '20', '50', '60'];
    const respostas = await Promise.all(
      etapas.map((etapa) => base44.functions.invoke('buscarPedidosOmie', {
        etapa,
        registros_por_pagina: 100,
        incluir_cancelados: true,
      }))
    );
    return respostas.flatMap((res) => res.data?.pedidos || []);
  };

  const { data: pedidosOmie = [], isLoading: carregandoPedidos } = useQuery({
    queryKey: ['pedidosOmieConsultaDireta'],
    queryFn: buscarPedidosOmiePorEtapas,
    refetchOnWindowFocus: true,
  });

  const vendas = pedidosOmie.filter((p) => !String(p.tipo_pedido || p.tipo || p.natureza_operacao || '').toLowerCase().includes('troca'));
  const trocas = pedidosOmie.filter((p) => String(p.tipo_pedido || p.tipo || p.natureza_operacao || p.status_pedido || '').toLowerCase().includes('troca'));

  const itensVenda = detalhe?.produtos || [];
  const itensTroca = detalhe?.produtos || [];

  const pedidos = useMemo(() => {
    const vendasMapeadas = vendas.map((p) => ({
      ...p,
      tipo_origem: 'venda',
      numero: p.numero_pedido || p.codigo_pedido,
      data: p.data_pedido || p.data_previsao,
      status_info: statusVenda[p.status] || statusVenda[p.etapa] || statusVenda.rascunho,
      descricao_tipo: 'Venda',
      cliente_nome: p.cliente_nome || p.nome_cliente || p.codigo_cliente || '-',
      vendedor_nome: p.vendedor_nome || '-',
      valor_total: p.valor_total || p.valor_total_pedido || 0,
      busca_extra: p.numero_nota_fiscal || p.status_pedido || p.etapa || '',
    }));

    const trocasMapeadas = trocas.map((p) => ({
      ...p,
      tipo_origem: 'troca',
      numero: p.numero_pedido || p.codigo_pedido,
      data: p.data_troca || p.data_previsao,
      status_info: statusTroca[p.status] || statusTroca.aberto,
      descricao_tipo: tiposTroca[p.tipo] || p.tipo || 'Troca',
      cliente_nome: p.cliente_nome || p.nome_cliente || p.codigo_cliente || '-',
      vendedor_nome: p.vendedor_nome || '-',
      valor_total: p.valor_total || p.valor_total_pedido || 0,
      busca_extra: p.motivo_descricao || p.status_pedido || p.etapa || '',
    }));

    return [...vendasMapeadas, ...trocasMapeadas].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  }, [vendas, trocas]);

  const filtrados = pedidos.filter((pedido) => {
    if (tipo !== 'todos' && pedido.tipo_origem !== tipo) return false;
    if (!busca.trim()) return true;
    const termo = busca.toLowerCase();
    return [pedido.numero, pedido.cliente_nome, pedido.vendedor_nome, pedido.busca_extra]
      .some((valor) => String(valor || '').toLowerCase().includes(termo));
  });

  const carregando = carregandoPedidos;
  const itensDetalhe = detalhe?.tipo_origem === 'venda' ? itensVenda : itensTroca;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Total</p><p className="text-2xl font-bold">{pedidos.length}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Vendas</p><p className="text-2xl font-bold text-amber-700">{vendas.length}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Trocas</p><p className="text-2xl font-bold text-orange-700">{trocas.length}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Valor exibido</p><p className="text-lg font-bold">{formatarMoeda(filtrados.reduce((s, p) => s + (p.valor_total || 0), 0))}</p></CardContent></Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por pedido, cliente, vendedor, NF ou motivo..." className="pl-8" />
        </div>
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="sm:w-52"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os pedidos</SelectItem>
            <SelectItem value="venda">Pedidos de venda</SelectItem>
            <SelectItem value="troca">Pedidos de troca</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {carregando ? <p className="text-center py-10 text-slate-500">Carregando pedidos do Omie...</p> : (
        <div className="space-y-2">
          {filtrados.length === 0 ? <Card><CardContent className="py-10 text-center text-slate-500">Nenhum pedido encontrado.</CardContent></Card> : filtrados.map((pedido) => {
            const Icone = pedido.tipo_origem === 'venda' ? ShoppingCart : ArrowLeftRight;
            return (
              <Card key={`${pedido.tipo_origem}-${pedido.id}`} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${pedido.tipo_origem === 'venda' ? 'bg-amber-50' : 'bg-orange-50'}`}>
                        <Icone className={`w-5 h-5 ${pedido.tipo_origem === 'venda' ? 'text-amber-600' : 'text-orange-600'}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 truncate">{pedido.numero || '-'} {pedido.numero_nota_fiscal && <span className="font-normal text-slate-500">· NF {pedido.numero_nota_fiscal}</span>}</div>
                        <div className="text-xs text-slate-500 truncate">{pedido.cliente_nome || '-'} · {pedido.vendedor_nome || '-'}</div>
                        <div className="text-xs text-slate-400">{formatarData(pedido.data)} {pedido.busca_extra && `· ${pedido.busca_extra}`}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <span className="text-sm font-semibold text-slate-700">{formatarMoeda(pedido.valor_total)}</span>
                      <Badge className={pedido.tipo_origem === 'venda' ? 'bg-amber-100 text-amber-800' : 'bg-orange-100 text-orange-800'}>{pedido.descricao_tipo}</Badge>
                      <Badge className={pedido.status_info.color}>{pedido.status_info.label}</Badge>
                      <Button variant="outline" size="sm" className="h-8" onClick={() => setDetalhe(pedido)}><Eye className="w-4 h-4 mr-1" />Ver</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!detalhe} onOpenChange={() => setDetalhe(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{detalhe?.descricao_tipo} {detalhe?.numero}</DialogTitle></DialogHeader>
          {detalhe && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span className="text-slate-500">Cliente:</span> <b>{detalhe.cliente_nome || '-'}</b></div>
                <div><span className="text-slate-500">Vendedor:</span> <b>{detalhe.vendedor_nome || '-'}</b></div>
                <div><span className="text-slate-500">Data:</span> <b>{formatarData(detalhe.data)}</b></div>
                <div><span className="text-slate-500">Valor:</span> <b>{formatarMoeda(detalhe.valor_total)}</b></div>
                {detalhe.numero_nota_fiscal && <div><span className="text-slate-500">NF:</span> <b>{detalhe.numero_nota_fiscal}</b></div>}
                {detalhe.motivo_descricao && <div><span className="text-slate-500">Motivo:</span> <b>{detalhe.motivo_descricao}</b></div>}
              </div>
              {itensDetalhe.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-700 mb-2">Itens</p>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {itensDetalhe.map((item) => (
                      <div key={item.id} className="flex justify-between gap-3 p-2 bg-slate-50 rounded text-xs">
                        <span>{item.produto_nome}</span>
                        <span className="text-slate-500 whitespace-nowrap">{item.quantidade} {item.unidade_medida} {item.valor_total ? `· ${formatarMoeda(item.valor_total)}` : ''}</span>
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