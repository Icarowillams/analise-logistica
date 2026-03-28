import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, XCircle, Loader2, StopCircle } from 'lucide-react';

export default function EtapaSincronizando({ processado, total, progresso, sucessos, erros, resultados, onCancelar }) {
  return (
    <div className="space-y-5">
      {/* Progress header */}
      <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-5">
            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-lg font-bold text-blue-800">Enviando ao Omie...</p>
              <p className="text-sm text-blue-500">{processado} de {total} clientes processados</p>
            </div>
            <span className="text-3xl font-bold text-blue-800">{progresso}%</span>
          </div>

          <Progress value={progresso} className="h-3 mb-4" />

          <div className="grid grid-cols-3 gap-3">
            <CountCard label="Processados" value={processado} color="blue" />
            <CountCard label="Sucesso" value={sucessos} color="green" />
            <CountCard label="Erros" value={erros} color="red" />
          </div>
        </CardContent>
      </Card>

      {/* Live log */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-neutral-700">Log em tempo real</h3>
            <span className="text-xs text-neutral-400 animate-pulse">Atualizando...</span>
          </div>
          <ScrollArea className="h-[260px]">
            <div className="space-y-1 pr-2">
              {resultados.map((r, i) => (
                <div key={i} className={`flex items-center gap-2 p-2 rounded-lg text-sm ${r.sucesso ? 'bg-green-50' : 'bg-red-50'}`}>
                  {r.sucesso
                    ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    : <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                  }
                  <span className="font-medium truncate flex-1">{r.razao_social}</span>
                  <span className={`text-xs shrink-0 ${r.sucesso ? 'text-green-600' : 'text-red-500'}`}>
                    {r.sucesso ? (r.codigo_omie ? `#${r.codigo_omie}` : 'OK') : r.mensagem?.substring(0, 40)}
                  </span>
                </div>
              ))}
              {resultados.length === 0 && (
                <p className="text-center text-sm text-neutral-400 py-6">Aguardando processamento...</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button variant="destructive" onClick={onCancelar} size="sm">
          <StopCircle className="w-4 h-4 mr-1" /> Cancelar
        </Button>
      </div>

      <p className="text-xs text-center text-neutral-400">Não feche esta página durante a sincronização.</p>
    </div>
  );
}

function CountCard({ label, value, color }) {
  const bg = { blue: 'bg-blue-100 text-blue-800', green: 'bg-green-100 text-green-800', red: 'bg-red-100 text-red-800' };
  return (
    <div className={`rounded-lg p-3 text-center ${bg[color]}`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs opacity-70">{label}</p>
    </div>
  );
}