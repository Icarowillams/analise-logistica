import React from 'react';

// Header de cada coluna do Kanban com totais e badge.
export default function HeaderColunaTotais({ titulo, badge, headerColor, count, valorTotal, loading }) {
  return (
    <div className={`px-4 py-3 border-b border-slate-200 rounded-t-xl bg-${headerColor}-50`}>
      <div className="flex items-center justify-between">
        <div className="font-bold text-sm text-slate-800 uppercase tracking-wide">{titulo}</div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-${headerColor}-200 text-${headerColor}-800 min-w-[24px] text-center`}>
          {loading ? '…' : count}
        </span>
      </div>
      {badge && <div className="text-[11px] text-slate-500 mt-0.5">{badge}</div>}
      {!loading && valorTotal > 0 && (
        <div className={`text-[11px] font-bold text-${headerColor}-800 mt-1`}>
          R$ {valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}