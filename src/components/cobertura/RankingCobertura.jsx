import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Trophy, Loader2 } from 'lucide-react';

export default function RankingCobertura() {
  const { data: coberturas = [], isLoading } = useQuery({
    queryKey: ['cobertura-ranking'],
    queryFn: () => base44.entities.CoberturaStatus.list('', 5000),
  });

  const ranking = useMemo(() => {
    const porResp = {};
    coberturas.forEach((c) => {
      const k = c.responsavel_id || 'sem';
      if (!porResp[k]) porResp[k] = { nome: c.responsavel_nome || 'Sem responsável', total: 0, em_dia: 0 };
      porResp[k].total++;
      if (c.status_cobertura === 'em_dia') porResp[k].em_dia++;
    });
    return Object.values(porResp)
      .map((r) => ({ ...r, pct: r.total ? Math.round((r.em_dia / r.total) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);
  }, [coberturas]);

  const medalha = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="w-5 h-5 text-amber-500" />
        <h3 className="font-semibold text-slate-800">Ranking de cobertura — % de clientes em dia</h3>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : ranking.length === 0 ? (
        <Card className="p-8 text-center text-slate-400">Sem dados de cobertura ainda.</Card>
      ) : (
        <div className="space-y-2">
          {ranking.map((r, i) => (
            <Card key={i} className="p-4 flex items-center gap-4">
              <div className="w-10 text-center text-lg font-bold text-slate-700">{medalha(i)}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800 truncate">{r.nome}</div>
                <div className="h-2 bg-slate-100 rounded-full mt-1 overflow-hidden">
                  <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${r.pct}%` }} />
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-cyan-600">{r.pct}%</div>
                <div className="text-[11px] text-slate-400">{r.em_dia}/{r.total} clientes</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}