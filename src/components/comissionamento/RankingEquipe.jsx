import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy } from 'lucide-react';
import { brl } from './scorecardUtils';

const MEDALHA = ['🥇', '🥈', '🥉'];

export default function RankingEquipe({ usuarios = [], titulo = 'Ranking' }) {
  const ordenado = [...usuarios].sort((a, b) => b.pontos - a.pontos);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="w-5 h-5 text-amber-500" /> {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {ordenado.length === 0 ? (
          <p className="p-8 text-center text-slate-400">Nenhum dado apurado nesta competência.</p>
        ) : (
          <div className="divide-y">
            {ordenado.map((u, i) => (
              <div key={u.usuario_id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="w-8 text-center text-lg font-bold text-slate-400">
                  {MEDALHA[i] || (i + 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">{u.usuario_nome}</p>
                  <p className="text-xs text-slate-400">{u.perfil} · {u.pontos.toFixed(1)} pts</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-emerald-700">{brl(u.comissao_oficial)}</p>
                  {u.comissao_experimental > 0 && (
                    <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px]">
                      +{brl(u.comissao_experimental)} exp
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}