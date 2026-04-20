import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ShoppingCart, RotateCcw, Route, CheckSquare, DollarSign } from 'lucide-react';

export default function StatsCardsMontagem({ pedidos, selecionados }) {
  const vendas = pedidos.filter(p => p.tipo !== 'troca').length;
  const trocas = pedidos.filter(p => p.tipo === 'troca').length;
  const rotas = new Set(pedidos.map(p => p.rota_nome || 'Sem Rota')).size;
  const pedidosSel = pedidos.filter(p => selecionados.includes(p.codigo_pedido));
  const valorSel = pedidosSel.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);

  const stats = [
    { label: 'Pedidos Venda', value: vendas, icon: ShoppingCart, color: 'text-blue-600 bg-blue-50' },
    { label: 'Pedidos Troca', value: trocas, icon: RotateCcw, color: 'text-orange-600 bg-orange-50' },
    { label: 'Roteiros', value: rotas, icon: Route, color: 'text-purple-600 bg-purple-50' },
    { label: 'Selecionados', value: selecionados.length, icon: CheckSquare, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Valor', value: `R$ ${valorSel.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-amber-600 bg-amber-50' }
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {stats.map(s => (
        <Card key={s.label}>
          <CardContent className="p-3 flex items-center gap-2">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.color}`}>
              <s.icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-500 truncate">{s.label}</div>
              <div className="text-sm font-bold truncate">{s.value}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}