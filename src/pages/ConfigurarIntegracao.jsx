import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, Copy, CheckCircle, AlertCircle, Clock, Zap } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';

export default function ConfigurarIntegracao() {
  const [copied, setCopied] = useState(false);
  
  const cronJobUrl = `${window.location.origin}/api/functions/importarVisitasGestorVisita`;

  const copiarUrl = () => {
    navigator.clipboard.writeText(cronJobUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Configuração da Integração Automática" 
        subtitle="Sincronização periódica com Gestor Visita" 
        icon={RefreshCw}
      />

      <Alert className="bg-green-50 border-green-200">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800">
          <strong>Integração Configurada!</strong> Os dados do Gestor Visita são importados automaticamente a cada 2 horas.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4 border-green-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg">
                <Zap className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Frequência</p>
                <p className="text-lg font-bold text-slate-900">A cada 2 horas</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-blue-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Clock className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Horários</p>
                <p className="text-lg font-bold text-slate-900">00:00, 02:00, 04:00...</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-purple-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <RefreshCw className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Modo</p>
                <p className="text-lg font-bold text-slate-900">Somente Novos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Como Funciona a Integração</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 list-decimal list-inside text-slate-700">
            <li><strong>Agendamento Externo:</strong> Um serviço de cron job (cron-job.org) chama a função de importação automaticamente</li>
            <li><strong>Busca no Gestor Visita:</strong> O sistema conecta no Gestor Visita via API e busca todos os registros</li>
            <li><strong>Detecção de Duplicatas:</strong> Compara com registros existentes e importa APENAS os novos</li>
            <li><strong>Importação em Lote:</strong> Processa múltiplos registros simultaneamente para maior velocidade</li>
            <li><strong>Atualização de Contadores:</strong> Atualiza as estatísticas automaticamente</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>URL do Cron Job</CardTitle>
          <CardDescription>
            Esta URL é chamada automaticamente a cada 2 horas pelo cron-job.org
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input 
              value={cronJobUrl} 
              readOnly 
              className="font-mono text-sm"
            />
            <Button onClick={copiarUrl} variant="outline">
              {copied ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="bg-slate-50 p-4 rounded-lg">
              <p className="text-sm font-medium text-slate-700 mb-2">Método HTTP:</p>
              <code className="text-sm bg-white px-3 py-1 rounded border">POST</code>
            </div>

            <div className="bg-slate-50 p-4 rounded-lg">
              <p className="text-sm font-medium text-slate-700 mb-2">Intervalo:</p>
              <code className="text-sm bg-white px-3 py-1 rounded border">0 */2 * * *</code>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuração no cron-job.org</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 list-decimal list-inside text-slate-700">
            <li>Acesse <a href="https://cron-job.org" target="_blank" className="text-blue-600 hover:underline">cron-job.org</a> e crie uma conta gratuita</li>
            <li>Clique em <strong>"Create cronjob"</strong></li>
            <li>Cole a URL acima no campo <strong>"URL"</strong></li>
            <li>Selecione <strong>"Every 2 hours"</strong> ou use a expressão: <code>0 */2 * * *</code></li>
            <li>Método: <strong>POST</strong></li>
            <li>Salve e ative o cron job</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recursos da Integração</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-green-50 p-4 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600 mb-2" />
              <p className="font-semibold text-green-900">Zero Duplicatas</p>
              <p className="text-sm text-green-700">Detecta e ignora registros já importados automaticamente</p>
            </div>
            
            <div className="bg-blue-50 p-4 rounded-lg">
              <CheckCircle className="w-5 h-5 text-blue-600 mb-2" />
              <p className="font-semibold text-blue-900">Busca Completa</p>
              <p className="text-sm text-blue-700">Busca todas as visitas, estoques e trocas em uma única operação</p>
            </div>
            
            <div className="bg-purple-50 p-4 rounded-lg">
              <CheckCircle className="w-5 h-5 text-purple-600 mb-2" />
              <p className="font-semibold text-purple-900">Processamento Otimizado</p>
              <p className="text-sm text-purple-700">Importa em lotes com delays para evitar sobrecarga</p>
            </div>
            
            <div className="bg-orange-50 p-4 rounded-lg">
              <CheckCircle className="w-5 h-5 text-orange-600 mb-2" />
              <p className="font-semibold text-orange-900">Tratamento de Erros</p>
              <p className="text-sm text-orange-700">Continua processando mesmo se houver falhas pontuais</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Alert className="bg-amber-50 border-amber-200">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800">
          <strong>Importante:</strong> Após configurar o cron job, acompanhe as primeiras execuções em "Importações" 
          para garantir que os dados estão sendo recebidos corretamente.
        </AlertDescription>
      </Alert>
    </div>
  );
}