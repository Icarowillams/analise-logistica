import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';

export default function SincronizarGestorVisita() {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);

  const sincronizar = async () => {
    setLoading(true);
    setResultado(null);
    
    try {
      const response = await base44.functions.invoke('sincronizarGestorVisita', {});
      setResultado(response.data);
    } catch (error) {
      setResultado({
        success: false,
        error: error.message || 'Erro ao sincronizar dados'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center shadow-lg">
          <RefreshCw className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sincronizar Gestor Visita</h1>
          <p className="text-slate-500">Importar roteiros do Pão e Mel Gestor Visita</p>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle>Importação de Roteiros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-slate-600">
            Esta ferramenta importa os dados de roteiros do aplicativo <strong>Pão e Mel Gestor Visita</strong> 
            e os registra como vendas neste sistema.
          </p>

          <Button
            onClick={sincronizar}
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-500 to-cyan-600"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Sincronizando...
              </>
            ) : (
              <>
                <Download className="w-5 h-5 mr-2" />
                Sincronizar Agora
              </>
            )}
          </Button>

          {resultado && (
            <Alert className={resultado.success ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}>
              <div className="flex items-start gap-3">
                {resultado.success ? (
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                )}
                <div className="flex-1">
                  <AlertDescription>
                    {resultado.success ? (
                      <div className="space-y-2">
                        <p className="font-semibold text-green-800">Sincronização concluída com sucesso!</p>
                        <div className="text-sm text-green-700">
                          <p>• Total de roteiros encontrados: <strong>{resultado.total_roteiros}</strong></p>
                          <p>• Roteiros importados: <strong>{resultado.importados}</strong></p>
                          {resultado.erros && resultado.erros.length > 0 && (
                            <div className="mt-2">
                              <p className="font-semibold">Erros encontrados:</p>
                              <ul className="list-disc list-inside">
                                {resultado.erros.map((err, idx) => (
                                  <li key={idx}>Roteiro {err.roteiro_id}: {err.erro}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="font-semibold text-red-800">Erro na sincronização</p>
                        <p className="text-sm text-red-700">{resultado.error || resultado.details || 'Erro desconhecido'}</p>
                      </div>
                    )}
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-lg bg-blue-50">
        <CardHeader>
          <CardTitle className="text-base">ℹ️ Informações</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-2">
          <p>• A sincronização busca todos os roteiros disponíveis no Gestor Visita</p>
          <p>• Os dados são importados como registros de vendas</p>
          <p>• Roteiros já importados podem gerar duplicatas se executado múltiplas vezes</p>
          <p>• Em caso de erro, verifique as configurações de conexão com o Gestor Visita</p>
        </CardContent>
      </Card>
    </div>
  );
}