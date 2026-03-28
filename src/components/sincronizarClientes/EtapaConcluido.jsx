import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, XCircle, RefreshCw, ArrowLeft, AlertCircle, Download, Trophy, PartyPopper } from 'lucide-react';

export default function EtapaConcluido({ processado, sucessos, erros, resultados, erroMsg, onReverificar, onVoltar }) {
  const taxa = processado > 0 ? Math.round((sucessos / processado) * 100) : 0;
  const perfeito = erros === 0 && sucessos > 0;

  const errosList = useMemo(() => resultados.filter(r => !r.sucesso), [resultados]);
  const sucessosList = useMemo(() => resultados.filter(r => r.sucesso), [resultados]);

  const exportarCSV = () => {
    let csv = 'Status;Razão Social;Código Omie;Mensagem\n';
    resultados.forEach(r => {
      csv += `${r.sucesso ? 'Sucesso' : 'Erro'};${r.razao_social};${r.codigo_omie || '-'};${r.mensagem || ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sync_clientes_omie_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {erroMsg && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{erroMsg}</AlertDescription>
        </Alert>
      )}

      {/* Hero */}
      <Card className={`border-2 ${perfeito ? 'border-green-200 bg-gradient-to-br from-green-50 to-emerald-50' : 'border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50'}`}>
        <CardContent className="p-6 sm:p-8 text-center">
          <div className={`h-16 w-16 rounded-full mx-auto mb-4 flex items-center justify-center ${perfeito ? 'bg-green-100' : 'bg-amber-100'}`}>
            {perfeito ? <Trophy className="w-8 h-8 text-green-600" /> : <AlertCircle className="w-8 h-8 text-amber-600" />}
          </div>
          <h2 className={`text-2xl font-bold ${perfeito ? 'text-green-800' : 'text-amber-800'}`}>
            {perfeito ? 'Sincronização Perfeita!' : 'Sincronização Concluída'}
          </h2>
          <p className={`text-sm mt-1 ${perfeito ? 'text-green-600' : 'text-amber-600'}`}>
            {perfeito
              ? `Todos os ${sucessos} clientes foram enviados com sucesso ao Omie.`
              : `${sucessos} enviados com sucesso, ${erros} com erro.`
            }
          </p>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={processado} color="slate" />
        <StatCard label="Sucesso" value={sucessos} color="green" />
        <StatCard label="Erros" value={erros} color="red" />
        <StatCard label="Taxa" value={`${taxa}%`} color={taxa === 100 ? 'green' : taxa > 80 ? 'amber' : 'red'} />
      </div>

      {/* Errors section */}
      {errosList.length > 0 && (
        <Card className="border-red-200">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-2">
              <XCircle className="w-4 h-4" />
              Clientes com Erro ({errosList.length})
            </h3>
            <ScrollArea className="h-[180px]">
              <div className="space-y-1.5 pr-2">
                {errosList.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-red-50 rounded-lg">
                    <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-red-800 truncate">{r.razao_social}</p>
                      <p className="text-xs text-red-500 break-words">{r.mensagem}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Success section */}
      {sucessosList.length > 0 && (
        <Card className="border-green-200">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-green-700 mb-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Enviados com Sucesso ({sucessosList.length})
            </h3>
            <ScrollArea className="h-[180px]">
              <div className="space-y-1 pr-2">
                {sucessosList.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-green-50 rounded-lg text-sm">
                    <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="truncate flex-1 font-medium text-green-800">{r.razao_social}</span>
                    {r.codigo_omie && <Badge className="bg-green-100 text-green-700 border-green-200 shrink-0">#{r.codigo_omie}</Badge>}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <div className="flex gap-2">
          <Button variant="outline" onClick={onVoltar}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Início
          </Button>
          <Button variant="outline" onClick={onReverificar}>
            <RefreshCw className="w-4 h-4 mr-1" /> Reverificar
          </Button>
        </div>
        {resultados.length > 0 && (
          <Button variant="outline" onClick={exportarCSV}>
            <Download className="w-4 h-4 mr-1" /> Exportar CSV
          </Button>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  const colors = {
    slate: 'bg-slate-50 text-slate-800 border-slate-200',
    green: 'bg-green-50 text-green-800 border-green-200',
    red: 'bg-red-50 text-red-800 border-red-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
  };
  return (
    <div className={`rounded-xl border p-3 text-center ${colors[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs opacity-70">{label}</p>
    </div>
  );
}