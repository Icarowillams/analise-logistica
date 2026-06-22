import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trophy, Medal } from 'lucide-react';
import { brl } from './scorecardUtils.js';

// Ranking por pontuação composta (gamificação — seção 6.4).
export default function RankingEquipe({ usuarios, titulo = 'Ranking' }) {
  const ordenados = [...usuarios].sort((a, b) => b.pontos - a.pontos);
  const medalha = (i) => i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-orange-700' : 'text-slate-300';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" /> {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {ordenados.length === 0 && <p className="text-sm text-slate-400">Sem dados na competência.</p>}
        {ordenados.map((u, i) => (
          <div key={u.usuario_id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-6 text-center font-bold ${medalha(i)}`}>
                {i < 3 ? <Medal className="w-4 h-4 inline" /> : i + 1}
              </div>
              <span className="text-sm font-medium text-slate-700 truncate">{u.usuario_nome}</span>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span className="text-xs text-slate-400">{Math.round(u.pontos)} pts</span>
              <span className="text-sm font-semibold text-emerald-700">{brl(u.comissao_oficial)}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}