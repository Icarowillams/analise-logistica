import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

export default function ResultadoGeracaoBoletos({ resultado }) {
  const { sucessos = 0, erros = 0, skips = 0, resultados = [] } = resultado || {};
  const listaErros = resultados.filter(r => !r.sucesso && !r.skip);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-3">
          <span>3. Resultado</span>
          <Badge className="bg-green-100 text-green-800">{sucessos} sucesso(s)</Badge>
          {erros > 0 && <Badge className="bg-red-100 text-red-800">{erros} erro(s)</Badge>}
          {skips > 0 && <Badge className="bg-gray-200 text-gray-800">{skips} ignorado(s)</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Resumo verde */}
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span><b>{sucessos}</b> boleto(s) gerado(s) com sucesso{skips > 0 ? ` — ${skips} ignorado(s)` : ''}.</span>
        </div>

        {/* Lista vermelha de erros */}
        {listaErros.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 font-medium text-red-800">
              <XCircle className="w-4 h-4 flex-shrink-0" /> {listaErros.length} com erro:
            </div>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {listaErros.map((r, i) => (
                <div key={i} className="text-red-700 text-xs">
                  • Título {r.codigo_lancamento}: {r.mensagem || 'erro desconhecido'}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-700">
              <tr>
                <th className="p-2 text-left font-semibold w-10"></th>
                <th className="p-2 text-left font-semibold">Título</th>
                <th className="p-2 text-left font-semibold">Nº Boleto</th>
                <th className="p-2 text-left font-semibold">Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2 text-center">
                    {r.sucesso
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 inline" />
                      : r.skip
                      ? <AlertCircle className="w-4 h-4 text-amber-500 inline" />
                      : <XCircle className="w-4 h-4 text-red-600 inline" />}
                  </td>
                  <td className="p-2 font-mono">{r.codigo_lancamento}</td>
                  <td className="p-2">{r.numero_boleto || '—'}</td>
                  <td className="p-2 text-slate-600">{r.mensagem || (r.sucesso ? 'Boleto gerado' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}