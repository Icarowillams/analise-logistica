import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, TrendingUp } from 'lucide-react';
import { brl, ORDEM_BLOCOS, LABEL_BLOCO, COR_NIVEL, LABEL_NIVEL } from './scorecardUtils';

function BlocoCard({ bloco, dados }) {
  const nivel = dados?.nivel || 'ZERADO';
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">{LABEL_BLOCO[bloco]}</p>
          <Badge variant="outline" className={COR_NIVEL[nivel]}>{LABEL_NIVEL[nivel]}</Badge>
        </div>
        <p className="text-xl font-bold text-slate-800">{brl(dados?.valor_comissao_bloco || 0)}</p>
        {dados?.meta_descricao_aplicada && (
          <p className="text-[11px] text-slate-400 truncate" title={dados.meta_descricao_aplicada}>
            Meta: {dados.meta_descricao_aplicada}
          </p>
        )}
        {dados?.status_apuracao === 'EXPERIMENTAL' && (
          <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px]">
            Experimental (shadow)
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

export default function PainelVendedor({ usuario, posicaoRanking }) {
  if (!usuario) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-slate-400">
          <Trophy className="w-10 h-10 mx-auto mb-3 text-slate-200" />
          Nenhum scorecard apurado para você nesta competência.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase text-emerald-700">Comissão Oficial</p>
            <p className="text-2xl font-bold text-emerald-700">{brl(usuario.comissao_oficial)}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase text-amber-700">Experimental</p>
            <p className="text-2xl font-bold text-amber-700">{brl(usuario.comissao_experimental)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase text-slate-500 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" /> Posição no Ranking
            </p>
            <p className="text-2xl font-bold text-slate-700">{posicaoRanking > 0 ? `${posicaoRanking}º` : '—'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {ORDEM_BLOCOS.map(b => (
          <BlocoCard key={b} bloco={b} dados={usuario.blocos[b]} />
        ))}
      </div>
    </div>
  );
}