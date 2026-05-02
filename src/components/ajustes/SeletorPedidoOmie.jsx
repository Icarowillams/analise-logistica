import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, RefreshCw, Package } from 'lucide-react';
import { toast } from 'sonner';

const ETAPA_LABELS = {
  '10': { label: 'Pedido Venda', color: 'bg-amber-100 text-amber-800' },
  '20': { label: 'Liberados', color: 'bg-blue-100 text-blue-800' },
  '50': { label: 'Faturar', color: 'bg-orange-100 text-orange-800' },
  '60': { label: 'Faturado', color: 'bg-green-100 text-green-800' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
};

const pedidoCancelado = (pedido) => pedido?.cancelado === true || pedido?.status_pedido === 'cancelado' || pedido?.status === 'cancelado';

/**
 * Seletor de pedidos do Omie. Carrega TODOS os pedidos das etapas indicadas
 * (default: 10/20/50/60) e permite o usuário pesquisar e selecionar.
 *
 * Props:
 * - etapas: array de etapas a buscar. default ['10','20','50']
 * - onPedidoCarregado: callback com o pedido completo (formato consultarPedidoOmie)
 */
export default function SeletorPedidoOmie({ onPedidoCarregado, etapas = ['10', '20', '50'] }) {
  const [busca, setBusca] = useState('');
  const [carregandoId, setCarregandoId] = useState(null);

  const { data: pedidos = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['ajustes-pedidos-omie', etapas.join(',')],
    queryFn: async () => {
      const requests = etapas.map(et =>
        base44.functions.invoke('buscarPedidosOmie', {
          etapa: et,
          registros_por_pagina: 100,
          buscar_todas_paginas: true
        })
          .then(r => (r.data?.pedidos || []).map(p => ({ ...p, etapa: et })))
          .catch(() => [])
      );
      const arrays = await Promise.all(requests);
      const todos = arrays.flat();
      // Remove duplicatas por codigo_pedido
      const map = new Map();
      todos.forEach(p => map.set(String(p.codigo_pedido), p));
      return Array.from(map.values()).sort((a, b) => Number(pedidoCancelado(a)) - Number(pedidoCancelado(b)));
    },
    staleTime: 60000,
    refetchOnWindowFocus: false
  });

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return pedidos;
    return pedidos.filter(p =>
      String(p.numero_pedido || '').toLowerCase().includes(t) ||
      String(p.codigo_pedido || '').toLowerCase().includes(t) ||
      (p.cliente_nome || '').toLowerCase().includes(t) ||
      (p.cliente_cpf_cnpj || '').includes(t) ||
      (p.cliente_cidade || '').toLowerCase().includes(t) ||
      (p.numero_nf || '').toString().includes(t)
    );
  }, [pedidos, busca]);

  const carregarPedido = async (codigo_pedido) => {
    setCarregandoId(codigo_pedido);
    try {
      const { data } = await base44.functions.invoke('consultarPedidoOmie', {
        codigo_pedido
      });
      if (data?.sucesso && data?.pedido) {
        onPedidoCarregado(data.pedido);
      } else {
        toast.error(data?.error || 'Pedido não encontrado');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setCarregandoId(null);
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar por nº pedido, cliente, CNPJ, NF, cidade..."
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        <div className="text-xs text-slate-500">
          {isLoading
            ? 'Carregando pedidos do Omie...'
            : `${filtrados.length} de ${pedidos.length} pedido(s) — etapas ${etapas.join(', ')}`
          }
        </div>

        <div className="border rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
              Buscando pedidos no Omie...
            </div>
          ) : filtrados.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Package className="w-8 h-8 inline mb-2 text-slate-300" />
              <div>{busca ? 'Nenhum pedido corresponde à busca' : 'Nenhum pedido disponível'}</div>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <th className="p-2 text-left">Nº Pedido</th>
                    <th className="p-2 text-left">Cliente</th>
                    <th className="p-2 text-left">Cidade</th>
                    <th className="p-2 text-left">Etapa</th>
                    <th className="p-2 text-right">Valor</th>
                    <th className="p-2 w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map(p => {
                    const cancelado = pedidoCancelado(p);
                    const etapa = cancelado ? ETAPA_LABELS.cancelado : (ETAPA_LABELS[p.etapa] || { label: p.etapa, color: 'bg-slate-100' });
                    return (
                      <tr key={p.codigo_pedido} className={`border-t ${cancelado ? 'bg-red-50 text-slate-500' : 'hover:bg-amber-50'}`}>
                        <td className="p-2 font-medium">{p.numero_pedido || p.codigo_pedido}</td>
                        <td className="p-2 truncate max-w-[260px]" title={p.cliente_nome}>
                          {p.cliente_nome || '-'}
                        </td>
                        <td className="p-2 text-slate-600 text-xs">{p.cliente_cidade || '-'}</td>
                        <td className="p-2">
                          <Badge className={`${etapa.color} text-[10px]`}>{etapa.label}</Badge>
                        </td>
                        <td className="p-2 text-right font-medium">
                          R$ {Number(p.valor_total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={cancelado || carregandoId === p.codigo_pedido}
                            onClick={() => carregarPedido(p.codigo_pedido)}
                          >
                            {cancelado
                              ? 'Cancelado'
                              : carregandoId === p.codigo_pedido
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : 'Selecionar'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}