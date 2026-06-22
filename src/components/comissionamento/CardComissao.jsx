import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, FlaskConical } from 'lucide-react';
import { brl } from './scorecardUtils.js';

// Card "Comissão do mês" — separa OFICIAL (garantido) de EXPERIMENTAL (estimado, em calibração).
// Nunca soma os dois num único número sem flag (seção 7 / considerações técnicas).
export default function CardComissao({ oficial, experimental }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-emerald-700 mb-1">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Comissão Oficial</span>
          </div>
          <p className="text-2xl font-bold text-emerald-700">{brl(oficial)}</p>
          <p className="text-[11px] text-emerald-600/80 mt-0.5">Valor garantido para pagamento</p>
        </CardContent>
      </Card>
      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-amber-700 mb-1">
            <FlaskConical className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Experimental</span>
          </div>
          <p className="text-2xl font-bold text-amber-700">{brl(experimental)}</p>
          <p className="text-[11px] text-amber-600/80 mt-0.5">Estimado — em calibração, não afeta pagamento</p>
        </CardContent>
      </Card>
    </div>
  );
}