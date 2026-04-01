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
    <div className="border border-amber-200 bg-amber-50/40 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 border-b border-amber-200">
        <span className="text-xs font-semibold text-amber-900">Pré-visualização dos produtos</span>
      </div>
      {itens.length === 0 ? (
        <div className="px-3 py-2 text-xs text-slate-500">Nenhum item encontrado.</div>
      ) : (
        <div className="overflow-auto max-h-40">
          <table className="w-full text-[11px] border-collapse">
            <thead className="bg-amber-100/60 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1 font-medium text-slate-600">Código</th>
                <th className="text-left px-2 py-1 font-medium text-slate-600">Produto</th>
                <th className="text-right px-2 py-1 font-medium text-slate-600">Qtd</th>
                <th className="text-right px-2 py-1 font-medium text-slate-600">Unit.</th>
                <th className="text-right px-2 py-1 font-medium text-slate-600">Total</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.id} className="border-t border-amber-100 hover:bg-amber-50">
                  <td className="px-2 py-0.5 text-slate-500 whitespace-nowrap">{item.produto_codigo || '-'}</td>
                  <td className="px-2 py-0.5 text-slate-900 font-medium truncate max-w-[300px]">{item.produto_nome || '-'}</td>
                  <td className="px-2 py-0.5 text-right text-slate-700">{item.quantidade || 0}</td>
                  <td className="px-2 py-0.5 text-right text-slate-500">{formatCurrency(item.valor_unitario)}</td>
                  <td className="px-2 py-0.5 text-right text-slate-900 font-semibold">{formatCurrency(item.valor_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}