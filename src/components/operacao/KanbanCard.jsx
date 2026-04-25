import React from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';

export default function KanbanCard({
  numero,
  titulo,
  subtitulo,
  valor,
  data,
  origem = 'Omie',
  borderColor = 'transparent',
  acaoLabel,
  acaoColor = 'amber',
  onAvancar,
  onClick,
  draggable = false,
  onDragStart,
  children
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      className="group bg-white rounded-md border border-slate-200 p-3 mb-2 hover:shadow-lg hover:border-slate-300 transition-all relative"
      style={{ borderLeft: `3px solid ${borderColor}`, cursor: draggable ? 'grab' : 'pointer' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pedido</span>
            <span className="text-xs font-bold text-slate-700">Nº {numero}</span>
          </div>
          <div className="font-bold text-sm text-slate-800 truncate mt-0.5">{titulo}</div>
          {subtitulo && <div className="text-xs text-slate-500 mt-0.5 truncate">{subtitulo}</div>}

          <div className="flex items-center gap-3 mt-2">
            {valor !== undefined && valor !== null && (
              <span className="text-sm font-bold text-emerald-600">
                R$ {Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            )}
            {data && (
              <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                {data}
              </span>
            )}
          </div>

          <div className="text-[10px] text-slate-400 mt-1.5">{origem}</div>
          {children}
        </div>
      </div>

      {acaoLabel && onAvancar && (
        <button
          onClick={(e) => { e.stopPropagation(); onAvancar(); }}
          className={`mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-md bg-${acaoColor}-50 text-${acaoColor}-700 hover:bg-${acaoColor}-500 hover:text-white border border-${acaoColor}-200 transition-colors opacity-0 group-hover:opacity-100`}
        >
          {acaoLabel}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}