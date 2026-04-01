import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const formatCurrency = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

export default function PedidoPreviewSelecionado({ pedidoId }) {
  const { data: itens = [] } = useQuery({
    queryKey: ['pedido-preview-itens', pedidoId],
    queryFn: () => base44.entities.PedidoItem.filter({ pedido_id: pedidoId }),
    enabled: !!pedidoId,
  });

  return (
    <Card className="border-amber-200 bg-amber-50/40 h-full min-h-[220px]">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-semibold text-amber-900">Pré-visualização dos produtos</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 h-[calc(100%-56px)]">
        {!pedidoId ? (
          <div className="h-full flex items-center justify-center text-center px-4">
            <p className="text-xs text-slate-500">Selecione um pedido para visualizar os produtos aqui.</p>
          </div>
        ) : itens.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center px-4">
            <p className="text-xs text-slate-500">Nenhum item encontrado neste pedido.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {itens.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-900">{item.produto_nome || 'Produto sem nome'}</span>
                    <Badge variant="outline" className="text-[10px]">{item.produto_codigo || '-'}</Badge>
                  </div>
                  <p className="text-[11px] text-slate-500">Qtd: {item.quantidade || 0} • Unit.: {formatCurrency(item.valor_unitario)}</p>
                </div>
                <div className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                  {formatCurrency(item.valor_total)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}