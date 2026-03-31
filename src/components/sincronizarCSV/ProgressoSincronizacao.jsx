import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Loader2 } from 'lucide-react';

export default function ProgressoSincronizacao({ titulo, icon, progresso, erros, executando, corBorda }) {
  if (progresso.total === 0) return null;

  const pct = progresso.total > 0 ? (progresso.atual / progresso.total) * 100 : 0;
  const concluido = !executando && progresso.atual >= progresso.total;

  return (
    <Card className={`border-${corBorda}-200`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>{progresso.atual}/{progresso.total}</span>
          <span className="flex gap-3">
            <span className="text-green-600">{progresso.ok} ok</span>
            <span className="text-red-600">{progresso.erros} erros</span>
          </span>
        </div>
        <Progress value={pct} />
        {concluido && (
          <p className="text-sm text-green-700 font-medium flex items-center gap-1">
            <CheckCircle className="w-4 h-4" /> Concluído!
          </p>
        )}
        {erros.length > 0 && (
          <div className="max-h-40 overflow-y-auto bg-red-50 border border-red-200 rounded p-2 mt-2 space-y-1">
            {erros.map((e, i) => (
              <p key={i} className="text-xs text-red-700">{e}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}