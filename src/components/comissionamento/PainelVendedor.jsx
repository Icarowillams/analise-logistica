import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Award } from 'lucide-react';
import CardComissao from './CardComissao';
import BlocoProgresso from './BlocoProgresso';
import { BLOCOS } from './scorecardUtils';

// Painel do Vendedor/Promotor (seção 6.1).
export default function PainelVendedor({ usuario, posicaoRanking }) {
  if (!usuario) {
    return <p className="text-sm text-slate-400 p-4">Nenhuma apuração encontrada para você nesta competência.</p>;
  }
  const temExcelenciaOficial = BLOCOS.some(b => {
    const bl = usuario.blocos[b];
    return bl && bl.status_apuracao === 'OFICIAL' && bl.nivel === 'EXCELENCIA';
  });

  return (
    <div className="space-y-4">
      <CardComissao oficial={usuario.comissao_oficial} experimental={usuario.comissao_experimental} />

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base">Seu Scorecard</CardTitle>
          <div className="flex items-center gap-3">
            {temExcelenciaOficial && (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <Award className="w-4 h-4" /> Excelência
              </span>
            )}
            {posicaoRanking > 0 && (
              <span className="text-xs text-slate-500">Ranking: <strong className="text-slate-700">#{posicaoRanking}</strong></span>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {BLOCOS.map(b => <BlocoProgresso key={b} blocoKey={b} apuracao={usuario.blocos[b]} />)}
        </CardContent>
      </Card>
    </div>
  );
}