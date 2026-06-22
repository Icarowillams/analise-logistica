import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { brl } from './scorecardUtils';

// Cards de comissão: separa claramente OFICIAL (folha real) de EXPERIMENTAL (calibração).
export default function CardComissao({ oficial, experimental }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Comissão Oficial</p>
          <p className="text-3xl font-bold text-emerald-700 mt-1">{brl(oficial)}</p>
          <p className="text-[11px] text-emerald-600/70 mt-1">Compõe sua folha de pagamento.</p>
        </CardContent>
      </Card>
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Experimental</p>
          <p className="text-3xl font-bold text-amber-700 mt-1">{brl(experimental)}</p>
          <p className="text-[11px] text-amber-600/70 mt-1">Em calibração — não impacta pagamento.</p>
        </CardContent>
      </Card>
    </div>
  );
}