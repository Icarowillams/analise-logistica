import React from 'react';
import { Loader2 } from 'lucide-react';

export default function KanbanColumn({ titulo, count, loading, children, footer, accentColor = 'amber' }) {
  return (
    <div className="flex flex-col bg-slate-50 rounded-lg border border-slate-200 min-w-[300px] max-w-[320px] flex-1">
      <div className="px-3 py-2.5 border-b border-slate-200 bg-white rounded-t-lg">
        <div className="font-semibold text-sm text-slate-800">{titulo}</div>
        <div className="text-xs text-slate-500">
          {loading ? 'Carregando...' : count > 0 ? `${count} registro${count > 1 ? 's' : ''}` : 'Nenhum registro'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 max-h-[calc(100vh-280px)]">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : count === 0 ? (
          <div className="text-center text-xs text-slate-400 py-6">Nenhum registro</div>
        ) : (
          children
        )}
      </div>
      {footer && (
        <div className={`p-2 border-t border-slate-200 bg-${accentColor}-500`}>
          {footer}
        </div>
      )}
    </div>
  );
}