import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Clock, Store } from 'lucide-react';

const tiposLabel = {
  acompanhamento: 'Acompanhamento', prospeccao: 'Prospecção',
  negociacao: 'Negociação', resolucao: 'Resolução'
};
const tiposColor = {
  acompanhamento: 'bg-blue-100 text-blue-800', prospeccao: 'bg-purple-100 text-purple-800',
  negociacao: 'bg-green-100 text-green-800', resolucao: 'bg-red-100 text-red-800'
};

export default function VisitaCardResumida({ visita }) {
  const tempoDisplay = () => {
    if (!visita.tempo_loja_minutos) return '-';
    const h = Math.floor(visita.tempo_loja_minutos / 60);
    const m = visita.tempo_loja_minutos % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };

  return (
    <Card className="bg-white">
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">
              <Store className="w-3 h-3 inline mr-1" />{visita.cliente_codigo} - {visita.cliente_nome}
            </p>
            <p className="text-xs text-slate-500">{visita.cliente_cidade}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {visita.tipos_visita?.map(t => (
                <Badge key={t} className={`text-[10px] px-1.5 py-0 ${tiposColor[t] || 'bg-slate-100'}`}>
                  {tiposLabel[t] || t}
                </Badge>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0 ml-2">
            <div className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle className="w-3 h-3" /><span>Concluída</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
              <Clock className="w-3 h-3" /><span>{tempoDisplay()}</span>
            </div>
          </div>
        </div>
        {visita.resumo_visita && (
          <p className="text-xs text-slate-600 mt-2 bg-slate-50 p-2 rounded">{visita.resumo_visita}</p>
        )}
      </CardContent>
    </Card>
  );
}