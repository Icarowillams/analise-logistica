import React from 'react';
import { formatCurrency, qtdPacotesPedido } from './montagemUtils';

export default function StatsCardsMontagem({ pedidos, selecionados }) {
  const pedidosSel = pedidos.filter(p => selecionados.includes(p.codigo_pedido));
  const valorSel = pedidosSel.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);
  const pacotesSel = pedidosSel.reduce((s, p) => s + qtdPacotesPedido(p), 0);
  const rotas = new Set(pedidos.map(p => p.rota_nome || 'Sem Rota')).size;

  const items = [
    ['Pedidos', pedidos.length],
    ['Rotas', rotas],
    ['Selecionados', selecionados.length],
    ['Pacotes', pacotesSel.toLocaleString('pt-BR')],
    ['Valor', formatCurrency(valorSel)]
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="bg-white rounded-xl px-4 py-3 shadow-sm">
          <div className="text-xs text-slate-500">{label}</div>
          <div className="text-lg font-semibold text-slate-950 truncate">{value}</div>
        </div>
      ))}
    </div>
  );
}