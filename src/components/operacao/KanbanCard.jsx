import React from 'react';
import { MoreVertical } from 'lucide-react';

export default function KanbanCard({ numero, titulo, subtitulo, valor, data, origem = 'Enviado via API', borderColor = 'transparent', onClick, children }) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-md border border-slate-200 p-3 mb-2 hover:shadow-md transition-shadow cursor-pointer relative"
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-500">Pedido Nº {numero}</div>
          <div className="font-bold text-sm text-slate-800 uppercase truncate">{titulo}</div>
          {subtitulo && <div className="text-xs text-slate-500 mt-0.5">{subtitulo}</div>}
          <div className="flex items-center gap-2 mt-1.5">
            {valor !== undefined && valor !== null && (
              <span className="text-sm font-semibold text-slate-700">
                $ {Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            )}
            {data && <span className="text-xs text-slate-500">p/ {data}</span>}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Origem: {origem}</div>
          {children}
        </div>
        <button className="text-slate-400 hover:text-slate-600 ml-1">
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}