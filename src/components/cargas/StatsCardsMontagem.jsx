import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CheckSquare, DollarSign, PackageCheck, RotateCcw, Route, ShoppingCart } from 'lucide-react';
import { formatCurrency, qtdPacotesPedido } from './montagemUtils';

export default function StatsCardsMontagem({ pedidos, selecionados }) {
  const vendas = pedidos.filter(p => p.tipo !== 'troca').length;
  const trocas = pedidos.filter(p => p.tipo === 'troca').length;
  const rotas = new Set(pedidos.map(p => p.rota_nome || 'Sem Rota')).size;
  const pedidosSel = pedidos.filter(p => selecionados.includes(p.codigo_pedido));
  const valorSel = pedidosSel.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);
  const pacotesSel = pedidosSel.reduce((s, p) => s + qtdPacotesPedido(p), 0);

  const stats = [
    { label: 'Vendas', value: vendas, icon: ShoppingCart, tone: 'bg-blue-50 text-blue-700 border-blue-100' },
    { label: 'Trocas', value: trocas, icon: RotateCcw, tone: 'bg-orange-50 text-orange-700 border-orange-100' },
    { label: 'Rotas', value: rotas, icon: Route, tone: 'bg-slate-50 text-slate-700 border-slate-200' },
    { label: 'Selecionados', value: selecionados.length, icon: CheckSquare, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    { label: 'Pacotes', value: pacotesSel.toLocaleString('pt-BR'), icon: PackageCheck, tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
    { label: 'Valor selecionado', value: formatCurrency(valorSel), icon: DollarSign, tone: 'bg-amber-50 text-amber-700 border-amber-100' }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3">
      {stats.map(s => (
        <Card key={s.label} className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`h-11 w-11 rounded-xl border flex items-center justify-center ${s.tone}`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 truncate">{s.label}</div>
              <div className="text-lg font-bold text-slate-900 truncate">{s.value}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}