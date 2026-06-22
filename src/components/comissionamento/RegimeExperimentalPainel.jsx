import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FlaskConical, Loader2, Play } from 'lucide-react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { competenciaLabel } from './scorecardUtils';

const LABEL_PARAM = {
  PESO_BLOCO_COBERTURA: 'Peso do Bloco Cobertura',
  PESO_BLOCO_MIX: 'Peso do Bloco Mix',
  TETO_SEGURANCA_FINANCEIRA: 'Teto de Segurança Financeira'
};

const COR_STATUS = {
  EM_ANDAMENTO: 'bg-sky-100 text-sky-700 border-sky-200',
  CONCLUIDO_AGUARDANDO_DECISAO: 'bg-amber-100 text-amber-700 border-amber-200',
  ENCERRADO: 'bg-slate-100 text-slate-600 border-slate-200'
};

const LABEL_STATUS = {
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDO_AGUARDANDO_DECISAO: 'Aguardando decisão',
  ENCERRADO: 'Encerrado'
};

function diasRestantes(dataFim) {
  if (!dataFim) return null;
  try {
    return differenceInCalendarDays(parseISO(dataFim), new Date());
  } catch {
    return null;
  }
}

export default function RegimeExperimentalPainel({ regimes = [], onIniciar, iniciando }) {
  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <FlaskConical className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800">Shadow Mode (30 dias)</p>
              <p className="text-sm text-amber-700/80 max-w-xl">
                Os pesos de Cobertura e Mix e o teto de segurança rodam em calibração antes de impactar o pagamento real.
              </p>
            </div>
          </div>
          <Button onClick={onIniciar} disabled={iniciando} className="bg-amber-500 hover:bg-amber-600 shrink-0">
            {iniciando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
            Iniciar Regime
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Janelas de Calibração</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {regimes.length === 0 ? (
            <p className="p-8 text-center text-slate-400">Nenhum regime experimental iniciado.</p>
          ) : (
            <div className="divide-y">
              {regimes.map(r => {
                const dias = diasRestantes(r.data_fim_prevista);
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800">{LABEL_PARAM[r.parametro_alvo] || r.parametro_alvo}</p>
                      <p className="text-xs text-slate-400">
                        {competenciaLabel((r.data_inicio || '').slice(0, 7))} → {(r.data_fim_prevista || '').split('-').reverse().join('/')}
                        {r.status === 'EM_ANDAMENTO' && dias != null && (
                          <span className="ml-2">{dias > 0 ? `${dias} dia(s) restante(s)` : 'período encerrado'}</span>
                        )}
                      </p>
                    </div>
                    <Badge variant="outline" className={COR_STATUS[r.status]}>
                      {LABEL_STATUS[r.status] || r.status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}