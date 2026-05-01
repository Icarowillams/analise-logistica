import React from 'react';
import { CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight } from 'lucide-react';

export default function TestResultsList({ results = [], running = false, currentIndex = -1 }) {
  const [expanded, setExpanded] = React.useState({});

  if (!results.length && !running) {
    return (
      <div className="text-center text-slate-400 py-12">
        Nenhum teste executado ainda.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {results.map((r, i) => {
        const isOpen = expanded[i];
        return (
          <div
            key={i}
            className={`border rounded-lg ${r.passed ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}
          >
            <button
              onClick={() => setExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
              className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-black/5 rounded-lg transition-colors"
            >
              {r.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
              )}
              <span className="text-sm font-medium flex-1 truncate">{r.description}</span>
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {r.duration}ms
              </span>
              {!r.passed && (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
            </button>
            {!r.passed && isOpen && (
              <div className="px-3 pb-3 pt-1 border-t border-red-200">
                <div className="text-xs font-mono bg-red-100/70 text-red-900 p-2 rounded whitespace-pre-wrap break-all">
                  {r.error}
                </div>
                {r.stack && (
                  <details className="mt-2">
                    <summary className="text-xs cursor-pointer text-slate-500">Stack trace</summary>
                    <pre className="text-xs mt-1 p-2 bg-slate-100 rounded overflow-auto max-h-40 whitespace-pre-wrap">{r.stack}</pre>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
      {running && (
        <div className="text-center py-4 text-sm text-slate-500 animate-pulse">
          Executando teste {currentIndex + 1}…
        </div>
      )}
    </div>
  );
}