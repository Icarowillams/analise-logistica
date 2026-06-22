import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';
import { BLOCO_LABEL, NIVEL_CONFIG } from './scorecardUtils.js';

// Barra de progresso de um bloco do scorecard, com cor por nível, valor do indicador
// e a meta aplicada (transparência sobre o parâmetro usado — seção 6.1).
export default function BlocoProgresso({ apuracao, blocoKey }) {
  if (!apuracao) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm text-slate-400">{BLOCO_LABEL[blocoKey]} — sem apuração</p>
      </div>
    );
  }
  const cfg = NIVEL_CONFIG[apuracao.nivel] || NIVEL_CONFIG.PADRAO;
  const experimental = apuracao.status_apuracao === 'EXPERIMENTAL';
  const largura = apuracao.nivel === 'EXCELENCIA' ? 100 : apuracao.nivel === 'PADRAO' ? 60 : 15;

  const valorTexto = apuracao.bloco === 'QUALIDADE'
    ? `${(Number(apuracao.valor_apurado) || 0).toFixed(1)}% de vencido`
    : apuracao.bloco === 'FATURAMENTO'
      ? (Number(apuracao.valor_apurado) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : 'em calibração';

  return (
    <div className={`rounded-lg border p-3 ${cfg.leve}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{BLOCO_LABEL[apuracao.bloco]}</span>
          {experimental && (
            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600 bg-amber-50">
              Experimental
            </Badge>
          )}
        </div>
        <span className={`text-xs font-bold ${cfg.texto}`}>{cfg.label}</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-white/70 overflow-hidden">
        <div className={`h-full rounded-full ${cfg.cor} transition-all`} style={{ width: `${largura}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
        <span>{valorTexto} · peso {Number(apuracao.peso_bloco) || 0}%</span>
        <span className="font-medium">{cfg.mult}</span>
      </div>
      {apuracao.meta_descricao_aplicada && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
          <Info className="w-3 h-3" />
          Meta: {apuracao.meta_descricao_aplicada}
        </div>
      )}
    </div>
  );
}