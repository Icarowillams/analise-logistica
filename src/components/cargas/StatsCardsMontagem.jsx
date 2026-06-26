import React from 'react';
import { formatCurrency, qtdPacotesPedido } from './montagemUtils';

export default function StatsCardsMontagem({ pedidos, selecionados }) {
  const pedidosSel = pedidos.filter(p => selecionados.includes(p.codigo_pedido));
  const valorSel = pedidosSel.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);
  const pacotesSel = pedidosSel.reduce((s, p) => s + qtdPacotesPedido(p), 0);
  const rotas = new Set(pedidos.map(p => p.rota_nome || 'Sem Rota')).size;

  const qtdNF = pedidos.filter(p => p.tipo !== 'd1' && p.tipo !== 'troca').length;
  const qtdD1 = pedidos.filter(p => p.tipo === 'd1').length;
  const qtdTroca = pedidos.filter(p => p.tipo === 'troca').length;
  const detalhePedidos = [
    qtdNF > 0 ? `${qtdNF} NF-e` : null,
    qtdD1 > 0 ? `${qtdD1} D1` : null,
    qtdTroca > 0 ? `${qtdTroca} troca` : null
  ].filter(Boolean).join(' + ');

  const items = [
    ['Pedidos', pedidos.length, detalhePedidos],
    ['Rotas', rotas],
    ['Selecionados', selecionados.length],
    ['Pacotes', pacotesSel.toLocaleString('pt-BR')],
    ['Valor', formatCurrency(valorSel)]
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {items.map(([label, value, sub]) => (
        <div key={label} className="bg-white rounded-xl px-4 py-3 shadow-sm">
          <div className="text-xs text-slate-500">{label}</div>
          <div className="text-lg font-semibold text-slate-950 truncate">{value}</div>
          {sub && <div className="text-[11px] text-slate-400 truncate">{sub}</div>}
        </div>
      ))}
    </div>
  );
}