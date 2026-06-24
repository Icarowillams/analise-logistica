import React from 'react';
import { Badge } from '@/components/ui/badge';
import { BLOCO_LABEL, NIVEL_CONFIG } from './scorecardUtils';

// Descrição legível do indicador apurado, por bloco.
function descricaoIndicador(blocoKey, apuracao) {
  if (!apuracao || apuracao.valor_apurado == null) return null;
  const v = apuracao.valor_apurado;
  if (blocoKey === 'COBERTURA') return `${v}% da carteira em dia (Cobertura Inteligente)`;
  if (blocoKey === 'QUALIDADE') return `${v}% de vencido`;
  if (blocoKey === 'MIX') return `${v}% do mix positivado`;
  if (blocoKey === 'FATURAMENTO') return `Base: ${(Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
  return null;
}

// Barra de progresso de um bloco do scorecard (Faturamento / Cobertura / Mix / Qualidade).
export default function BlocoProgresso({ blocoKey, apuracao }) {
  const nivel = apuracao?.nivel || 'ZERADO';
  const cfg = NIVEL_CONFIG[nivel] || NIVEL_CONFIG.ZERADO;
  const experimental = apuracao?.status_apuracao === 'EXPERIMENTAL';
  const indicador = descricaoIndicador(blocoKey, apuracao);

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
      {indicador && (
        <p className="text-[11px] text-slate-500 mt-1.5">{indicador}</p>
      )}
      {apuracao?.meta_descricao_aplicada && (
        <p className="text-[10px] text-slate-400 mt-1.5 truncate">Meta: {apuracao.meta_descricao_aplicada}</p>
      )}
    </div>
  );
}