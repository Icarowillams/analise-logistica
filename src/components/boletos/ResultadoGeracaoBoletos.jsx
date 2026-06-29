import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertCircle, RotateCcw, Printer, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

const base64ToUint8Array = (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
};

const abrirPdf = (bytes) => {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

export default function ResultadoGeracaoBoletos({ resultado }) {
  const { sucessos = 0, recuperados = 0, erros = 0, skips = 0, resultados = [] } = resultado || {};
  const listaErros = resultados.filter(r => !r.sucesso && !r.skip);
  const totalDisponiveis = sucessos + recuperados;
  const soRecuperados = recuperados > 0 && sucessos === 0 && erros === 0;
  const [imprimindoId, setImprimindoId] = useState(null);

  // Imprime/visualiza um boleto recuperado reusando o link já obtido (link_boleto) quando houver,
  // evitando rebuscar no Omie. Sem link, busca pelo codigo_lancamento (passa pelo throttle/breaker).
  const imprimirBoleto = async (r) => {
    setImprimindoId(r.codigo_lancamento);
    try {
      const { data } = await base44.functions.invoke('baixarPdfBoletoOmie', {
        codigo_lancamento: r.codigo_lancamento,
        url_boleto: r.link_boleto || undefined
      });
      if (!data?.sucesso) throw new Error(data?.error || 'Falha ao baixar boleto');
      abrirPdf(base64ToUint8Array(data.pdf_base64));
    } catch (e) {
      toast.error(`Erro ao imprimir boleto: ${e.message}`);
    } finally {
      setImprimindoId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-3 flex-wrap">
          <span>3. Resultado{soRecuperados ? ' — Boletos já disponíveis' : ''}</span>
          {sucessos > 0 && <Badge className="bg-green-100 text-green-800">{sucessos} novo(s) gerado(s)</Badge>}
          {recuperados > 0 && <Badge className="bg-blue-100 text-blue-800">{recuperados} já existente(s)</Badge>}
          {erros > 0 && <Badge className="bg-red-100 text-red-800">{erros} erro(s)</Badge>}
          {skips > 0 && <Badge className="bg-gray-200 text-gray-800">{skips} ignorado(s)</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Resumo informativo — verde para novos, azul quando só recuperados */}
        {soRecuperados ? (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span><b>{recuperados}</b> boleto(s) já estava(m) gerado(s) — pronto(s) para impressão. Use o botão <b>Imprimir</b> abaixo.</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>
              <b>{totalDisponiveis}</b> boleto(s) disponível(is)
              {recuperados > 0 ? ` (${sucessos} novo(s) + ${recuperados} já existente(s))` : ''}
              {skips > 0 ? ` — ${skips} ignorado(s)` : ''}.
            </span>
          </div>
        )}

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
                <th className="p-2 text-right font-semibold w-24">Ação</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((r, i) => {
                const disponivel = r.sucesso;
                return (
                  <tr key={i} className="border-t">
                    <td className="p-2 text-center">
                      {r.recuperado
                        ? <RotateCcw className="w-4 h-4 text-blue-600 inline" />
                        : r.sucesso
                        ? <CheckCircle2 className="w-4 h-4 text-green-600 inline" />
                        : r.skip
                        ? <AlertCircle className="w-4 h-4 text-amber-500 inline" />
                        : <XCircle className="w-4 h-4 text-red-600 inline" />}
                    </td>
                    <td className="p-2 font-mono">{r.codigo_lancamento}</td>
                    <td className="p-2">{r.numero_boleto || '—'}</td>
                    <td className="p-2 text-slate-600">
                      {r.recuperado
                        ? `Boleto já estava gerado — pronto para impressão${r.numero_boleto ? ` (nº ${r.numero_boleto})` : ''}`
                        : (r.mensagem || (r.sucesso ? 'Boleto gerado' : '—'))}
                    </td>
                    <td className="p-2 text-right">
                      {disponivel && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-cyan-300 text-cyan-700 hover:bg-cyan-50"
                          disabled={imprimindoId === r.codigo_lancamento}
                          onClick={() => imprimirBoleto(r)}
                        >
                          {imprimindoId === r.codigo_lancamento
                            ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            : <Printer className="w-3 h-3 mr-1" />}
                          Imprimir
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}