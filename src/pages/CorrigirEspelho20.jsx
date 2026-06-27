import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function CorrigirEspelho20() {
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);

  const executar = async () => {
    setRodando(true);
    setResultado(null);
    setErro(null);
    try {
      const res = await base44.functions.invoke('corrigirEspelho20Falso', {});
      setResultado(res.data);
    } catch (e) {
      setErro(e?.response?.data?.error || e.message || 'Erro ao executar');
    } finally {
      setRodando(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-cyan-600" />
          Corrigir Espelho "Liberado" Falso (20 → 10)
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Reconsulta no Omie os pedidos que o espelho mostra como <strong>Liberado (etapa 20)</strong> mas que podem
          estar em <strong>Bloqueado/Pendente (etapa 10)</strong> no Omie real, e corrige a etapa onde divergir.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como funciona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <ul className="list-disc list-inside space-y-1">
            <li>Consulta um a um (sequencial, com pausa) — <strong>respeita o bloqueio do Omie</strong> e aborta se a API travar.</li>
            <li>É só leitura no Omie: <strong>não fatura</strong> e não altera nada lá.</li>
            <li>Pode rodar quantas vezes quiser (idempotente).</li>
          </ul>

          <Button onClick={executar} disabled={rodando} className="bg-cyan-600 hover:bg-cyan-700 text-white">
            {rodando ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Consultando o Omie…</>) : 'Rodar correção agora'}
          </Button>
        </CardContent>
      </Card>

      {erro && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-700">{erro}</AlertDescription>
        </Alert>
      )}

      {resultado && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Resultado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {resultado.bloqueado ? (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-700">
                  {resultado.mensagem || 'API Omie bloqueada — tente novamente quando liberar.'}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="Analisados" value={resultado.total_candidatos} />
                  <Stat label="Corrigidos (20→real)" value={resultado.corrigidos} color="text-emerald-600" />
                  <Stat label="Confirmados em 20" value={resultado.confirmados_20} />
                  <Stat label="Sem etapa" value={resultado.sem_etapa} />
                </div>
                {resultado.abortado_por_rate_limit && (
                  <Alert className="border-amber-200 bg-amber-50">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <AlertDescription className="text-amber-700">
                      Parou no meio porque o Omie bloqueou (rate limit). Rode de novo mais tarde para concluir os restantes.
                    </AlertDescription>
                  </Alert>
                )}
                {Array.isArray(resultado.correcoes) && resultado.correcoes.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="text-left px-3 py-2">Pedido</th>
                          <th className="text-left px-3 py-2">Código Omie</th>
                          <th className="text-left px-3 py-2">De → Para</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultado.correcoes.map((c, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-2">{c.numero_pedido}</td>
                            <td className="px-3 py-2 text-slate-500">{c.codigo_pedido}</td>
                            <td className="px-3 py-2 font-medium">{c.de} → {c.para}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, color = 'text-slate-800' }) {
  return (
    <div className="border rounded-lg p-3 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value ?? 0}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}