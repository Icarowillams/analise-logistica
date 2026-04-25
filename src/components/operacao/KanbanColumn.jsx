import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function KanbanColumn({
  titulo,
  count,
  loading,
  children,
  footer,
  acceptDrop = false,
  onDrop,
  headerColor = 'slate',
  badge
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      className={`flex flex-col bg-white rounded-xl border min-w-[300px] max-w-[320px] flex-1 transition-all ${over ? 'border-amber-400 ring-2 ring-amber-200 bg-amber-50/30' : 'border-slate-200'}`}
      onDragOver={acceptDrop ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={acceptDrop ? () => setOver(false) : undefined}
      onDrop={acceptDrop ? (e) => { e.preventDefault(); setOver(false); onDrop?.(e); } : undefined}
    >
      <div className={`px-4 py-3 border-b border-slate-200 rounded-t-xl bg-${headerColor}-50`}>
        <div className="flex items-center justify-between">
          <div className="font-bold text-sm text-slate-800 uppercase tracking-wide">{titulo}</div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-${headerColor}-200 text-${headerColor}-800 min-w-[24px] text-center`}>
            {loading ? '…' : count}
          </span>
        </div>
        {badge && <div className="text-[11px] text-slate-500 mt-0.5">{badge}</div>}
      </div>

      <div className="flex-1 overflow-y-auto p-2 max-h-[calc(100vh-300px)] min-h-[200px]">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : count === 0 ? (
          <div className="text-center text-xs text-slate-400 py-10 border-2 border-dashed border-slate-200 rounded-lg m-1">
            {acceptDrop ? 'Arraste cards aqui' : 'Nenhum registro'}
          </div>
        ) : (
          children
        )}
      </div>

      {footer && (
        <div className="p-2 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          {footer}
        </div>
      )}
    </div>
  );
}