import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package } from 'lucide-react';

export default function ProdutosConsolidados({ pedidosSelecionados }) {
  const consolidado = useMemo(() => {
    const map = new Map();
    pedidosSelecionados.forEach(p => {
      (p.produtos || []).forEach(pr => {
        const k = pr.codigo_produto || pr.descricao;
        if (!map.has(k)) {
          map.set(k, {
            codigo: pr.codigo_produto,
            descricao: pr.descricao,
            unidade: pr.unidade || 'UN',
            quantidade: 0
          });
        }
        map.get(k).quantidade += Number(pr.quantidade) || 0;
      });
    });
    return Array.from(map.values()).sort((a, b) => (a.descricao || '').localeCompare(b.descricao || ''));
  }, [pedidosSelecionados]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Package className="w-4 h-4 text-amber-500" />
          Produtos Consolidados ({consolidado.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 max-h-80 overflow-auto">
        {consolidado.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">Selecione pedidos para ver</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="p-2 text-left">Produto</th>
                <th className="p-2 text-right">Qtd</th>
                <th className="p-2 text-left">UN</th>
              </tr>
            </thead>
            <tbody>
              {consolidado.map(p => (
                <tr key={p.codigo} className="border-t">
                  <td className="p-2">{p.descricao}</td>
                  <td className="p-2 text-right font-semibold">{p.quantidade}</td>
                  <td className="p-2">{p.unidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}