import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trophy } from 'lucide-react';
import { brl } from './scorecardUtils';

const MEDALHA = ['text-yellow-500', 'text-slate-400', 'text-amber-600'];

// Ranking de comissão da equipe (gamificação, seção 6.2).
export default function RankingEquipe({ usuarios, titulo = 'Ranking' }) {
  const ordenado = [...usuarios].sort((a, b) => b.pontos - a.pontos);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-yellow-500" /> {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 max-h-[600px] overflow-y-auto">
        {ordenado.length === 0 && (
          <p className="text-sm text-slate-400">Nenhuma apuração nesta competência. Recalcule para gerar o ranking.</p>
        )}
        {ordenado.map((u, i) => (
          <div key={u.usuario_id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`w-6 text-center font-bold ${MEDALHA[i] || 'text-slate-300'}`}>{i + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{u.usuario_nome}</p>
                <p className="text-[11px] text-slate-400">{u.perfil} · {u.pontos.toFixed(0)} pts</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-emerald-700">{brl(u.comissao_oficial)}</p>
              {u.comissao_experimental > 0 && (
                <p className="text-[11px] text-amber-600">exp. {brl(u.comissao_experimental)}</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}