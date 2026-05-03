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
            codigo: pr.codigo_produto || pr.descricao,
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
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-3 border-b border-slate-100">
        <CardTitle className="text-sm flex items-center gap-2 text-slate-900">
          <Package className="w-4 h-4 text-slate-700" />
          Produtos consolidados ({consolidado.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 max-h-80 overflow-auto">
        {consolidado.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">Selecione pedidos para consolidar os produtos</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0 text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="p-3 text-left">Produto</th>
                <th className="p-3 text-right">Qtd</th>
                <th className="p-3 text-left">UN</th>
              </tr>
            </thead>
            <tbody>
              {consolidado.map(p => (
                <tr key={p.codigo} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 text-slate-700">{p.descricao}</td>
                  <td className="p-3 text-right font-bold text-slate-900">{Number(p.quantidade || 0).toLocaleString('pt-BR')}</td>
                  <td className="p-3 text-slate-500">{p.unidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}