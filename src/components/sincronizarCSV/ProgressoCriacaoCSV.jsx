import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Loader2, ArrowLeftRight, Plus, Trash2 } from 'lucide-react';

function BarraProgresso({ titulo, icon, progresso, executando }) {
  if (progresso.total === 0) return null;
  const pct = progresso.total > 0 ? (progresso.atual / progresso.total) * 100 : 0;
  const concluido = !executando && progresso.atual >= progresso.total;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          {executando && progresso.atual < progresso.total ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
          {titulo}
        </span>
        <span className="text-xs text-slate-500">
          {progresso.atual}/{progresso.total} — 
          <span className="text-green-600 ml-1">{progresso.ok} ok</span>
          {progresso.erros > 0 && <span className="text-red-600 ml-1">{progresso.erros} erros</span>}
        </span>
      </div>
      <Progress value={pct} />
      {concluido && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" /> Concluído
        </p>
      )}
    </div>
  );
}

export default function ProgressoCriacaoCSV({ progressoAtualizar, progressoCriar, progressoExcluir, erros, executando }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {executando ? <Loader2 className="w-5 h-5 animate-spin text-blue-500" /> : <CheckCircle className="w-5 h-5 text-green-500" />}
          {executando ? 'Sincronizando...' : 'Sincronização concluída'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <BarraProgresso
          titulo="Atualizar divergentes"
          icon={<ArrowLeftRight className="w-3 h-3 text-amber-500" />}
          progresso={progressoAtualizar}
          executando={executando}
        />
        <BarraProgresso
          titulo="Criar faltantes"
          icon={<Plus className="w-3 h-3 text-purple-500" />}
          progresso={progressoCriar}
          executando={executando}
        />
        <BarraProgresso
          titulo="Excluir sobrantes"
          icon={<Trash2 className="w-3 h-3 text-red-500" />}
          progresso={progressoExcluir}
          executando={executando}
        />

        {erros.length > 0 && (
          <div className="max-h-40 overflow-y-auto bg-red-50 border border-red-200 rounded p-2 space-y-1">
            <p className="text-xs font-medium text-red-700">Erros ({erros.length}):</p>
            {erros.map((e, i) => (
              <p key={i} className="text-xs text-red-600">{e}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}