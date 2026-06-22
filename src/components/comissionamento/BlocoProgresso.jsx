import React from 'react';
import { Badge } from '@/components/ui/badge';
import { BLOCO_LABEL, NIVEL_CONFIG } from './scorecardUtils';

// Barra de progresso de um bloco do scorecard (Faturamento / Cobertura / Mix / Qualidade).
export default function BlocoProgresso({ blocoKey, apuracao }) {
  const nivel = apuracao?.nivel || 'ZERADO';
  const cfg = NIVEL_CONFIG[nivel] || NIVEL_CONFIG.ZERADO;
  const experimental = apuracao?.status_apuracao === 'EXPERIMENTAL';

  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">{BLOCO_LABEL[blocoKey] || blocoKey}</span>
          {experimental && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">Experimental</Badge>
          )}
        </div>
        <Badge variant="outline" className={`${cfg.cls} text-[11px]`}>{cfg.label}</Badge>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cfg.bar}`} style={{ width: `${cfg.pct}%` }} />
      </div>
      {apuracao?.meta_descricao_aplicada && (
        <p className="text-[10px] text-slate-400 mt-1.5 truncate">Meta: {apuracao.meta_descricao_aplicada}</p>
      )}
    </div>
  );
}