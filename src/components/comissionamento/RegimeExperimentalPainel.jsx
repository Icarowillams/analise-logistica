import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FlaskConical, Loader2, Play } from 'lucide-react';

const PARAM_LABEL = {
  PESO_BLOCO_COBERTURA: 'Peso do bloco Cobertura',
  PESO_BLOCO_MIX: 'Peso do bloco Mix',
  TETO_SEGURANCA_FINANCEIRA: 'Teto de segurança financeira'
};
const STATUS_CLS = {
  EM_ANDAMENTO: 'bg-blue-50 text-blue-700 border-blue-200',
  CONCLUIDO_AGUARDANDO_DECISAO: 'bg-amber-50 text-amber-700 border-amber-200',
  ENCERRADO: 'bg-slate-100 text-slate-500 border-slate-200'
};

function fmtData(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Painel de calibração (shadow mode 30 dias) — decisões #2 e #3.
export default function RegimeExperimentalPainel({ regimes = [], onIniciar, iniciando }) {
  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <FlaskConical className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Regime Experimental (shadow mode)</p>
              <p className="text-xs text-amber-700/80 mt-0.5">
                Calibra Cobertura, Mix e o teto de segurança por 30 dias sem impactar o pagamento real.
              </p>
            </div>
          </div>
          <Button onClick={onIniciar} disabled={iniciando} className="shrink-0">
            {iniciando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
            Iniciar janela de 30 dias
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Janelas de calibração ({regimes.length})</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {regimes.length === 0 && <p className="text-sm text-slate-400">Nenhuma janela iniciada.</p>}
          {regimes.map(r => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-700">{PARAM_LABEL[r.parametro_alvo] || r.parametro_alvo}</span>
                  <Badge variant="outline" className={STATUS_CLS[r.status]}>{(r.status || '').replace(/_/g, ' ')}</Badge>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{fmtData(r.data_inicio)} → {fmtData(r.data_fim_prevista)}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}