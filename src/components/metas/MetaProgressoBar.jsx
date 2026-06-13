import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

export function Semaforo({ pct, showLabel = true }) {
  if (pct >= 95) return (
    <span className="inline-flex items-center gap-1 text-green-600 font-semibold text-xs">
      <CheckCircle2 className="w-3.5 h-3.5" />{showLabel && 'Verde'}
    </span>
  );
  if (pct >= 80) return (
    <span className="inline-flex items-center gap-1 text-amber-500 font-semibold text-xs">
      <Clock className="w-3.5 h-3.5" />{showLabel && 'Amarelo'}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-red-600 font-semibold text-xs">
      <AlertTriangle className="w-3.5 h-3.5" />{showLabel && 'Vermelho'}
    </span>
  );
}

export function SemaforoBadge({ pct }) {
  if (pct >= 95) return <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">{pct.toFixed(1)}%</Badge>;
  if (pct >= 80) return <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">{pct.toFixed(1)}%</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-300 text-xs">{pct.toFixed(1)}%</Badge>;
}

export function MetaProgressoBar({ realizado, meta, className = '' }) {
  const pct = meta > 0 ? Math.min((realizado / meta) * 100, 100) : 0;
  const cor = pct >= 95 ? 'bg-green-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className={`w-full bg-slate-200 rounded-full h-2 ${className}`}>
      <div className={`h-2 rounded-full transition-all ${cor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}