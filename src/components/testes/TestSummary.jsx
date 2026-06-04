import React from 'react';
import { CheckCircle2, XCircle, Activity } from 'lucide-react';

export default function TestSummary({ summary }) {
  if (!summary) return null;
  const { total, passed, failed } = summary;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const allPassed = failed === 0 && passed > 0;

  return (
    <div className={`rounded-xl border p-4 ${allPassed ? 'border-emerald-200 bg-emerald-50' : failed > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex items-center gap-3">
        {allPassed ? (
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        ) : failed > 0 ? (
          <XCircle className="w-8 h-8 text-red-600" />
        ) : (
          <Activity className="w-8 h-8 text-slate-600" />
        )}
        <div className="flex-1">
          <div className="text-lg font-bold">
            {passed}/{total} testes passaram ({pct}%)
          </div>
          {failed > 0 && (
            <div className="text-sm text-red-700">{failed} falharam</div>
          )}
        </div>
        <div className="flex gap-2">
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-sm font-medium">
            ✓ {passed}
          </span>
          {failed > 0 && (
            <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 text-sm font-medium">
              ✗ {failed}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}