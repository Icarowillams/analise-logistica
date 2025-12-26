import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Webhook, Copy, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';

export default function ConfigurarWebhook() {
  const [copied, setCopied] = useState(false);
  
  // URL do webhook desta aplicação
  const webhookUrl = `${window.location.origin}/api/functions/receberDadosGestorVisita`;
  const appOrigemId = '68b1f50209adbcb52b0d911b';

  const copiarUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const payloadExemplo = {
    app_origem_id: appOrigemId,
    app_origem_nome: "Pão e Mel Gestor Visita",
    visitas: [
      {
        origem_visita_id: "abc123",
        cliente_nome: "Cliente Exemplo",
        cliente_codigo: "001",
        promotor_nome: "João Silva",
        data_visita: "2025-12-26T10:00:00Z",
        status: "realizada",
        pedido_solicitado: true
      }
    ],
    estoques: [
      {
        origem_estoque_id: "est456",
        origem_visita_id: "abc123",
        cliente_nome: "Cliente Exemplo",
        produto_codigo: "PROD001",
        produto_descricao: "Pão Francês",
        quantidade: 50,
        data_validade: "2025-12-30"
      }
    ],
    trocas: [
      {
        origem_troca_id: "trc789",
        origem_visita_id: "abc123",
        cliente_nome: "Cliente Exemplo",
        produto_codigo: "PROD002",
        produto_descricao: "Pão de Forma",
        motivo_troca: "Vencido",
        quantidade: 5,
        data_validade: "2025-12-25",
        data_fabricacao: "2025-12-01"
      }
    ]
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Configurar Webhook Automático" 
        subtitle="Receba dados do Gestor Visita automaticamente" 
        icon={Webhook}
      />

      <Alert className="bg-green-50 border-green-200">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800">
          <strong>Recebimento Automático Configurado!</strong> Esta aplicação está pronta para receber dados do Gestor Visita.
          Configure o webhook lá para enviar dados automaticamente aqui.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>URL do Webhook</CardTitle>
          <CardDescription>
            Configure esta URL no Gestor Visita para enviar dados automaticamente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input 
              value={webhookUrl} 
              readOnly 
              className="font-mono text-sm"
            />
            <Button onClick={copiarUrl} variant="outline">
              {copied ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          
          <div className="bg-slate-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-slate-700 mb-2">Método HTTP:</p>
            <code className="text-sm bg-white px-3 py-1 rounded border">POST</code>
          </div>

          <div className="bg-slate-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-slate-700 mb-2">Content-Type:</p>
            <code className="text-sm bg-white px-3 py-1 rounded border">application/json</code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instruções de Configuração</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 list-decimal list-inside text-slate-700">
            <li>Acesse o <strong>Gestor Visita</strong> com permissão de administrador</li>
            <li>Vá em <strong>Configurações → Integrações → Webhooks</strong></li>
            <li>Clique em <strong>"Adicionar Webhook"</strong></li>
            <li>Cole a URL acima no campo <strong>"URL do Webhook"</strong></li>
            <li>Selecione os eventos: <strong>Nova Visita, Novo Estoque, Nova Troca</strong></li>
            <li>Salve as configurações</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Formato do Payload (JSON)</CardTitle>
          <CardDescription>
            Exemplo de dados que o Gestor Visita deve enviar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-slate-900 text-green-400 p-4 rounded-lg overflow-x-auto text-xs">
            {JSON.stringify(payloadExemplo, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recursos do Webhook</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <CheckCircle className="w-5 h-5 text-blue-600 mb-2" />
              <p className="font-semibold text-blue-900">Detecção de Duplicatas</p>
              <p className="text-sm text-blue-700">Ignora automaticamente registros já importados</p>
            </div>
            
            <div className="bg-green-50 p-4 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600 mb-2" />
              <p className="font-semibold text-green-900">Importação em Lote</p>
              <p className="text-sm text-green-700">Processa múltiplos registros simultaneamente</p>
            </div>
            
            <div className="bg-purple-50 p-4 rounded-lg">
              <CheckCircle className="w-5 h-5 text-purple-600 mb-2" />
              <p className="font-semibold text-purple-900">Atualização Automática</p>
              <p className="text-sm text-purple-700">Atualiza contadores e estatísticas em tempo real</p>
            </div>
            
            <div className="bg-orange-50 p-4 rounded-lg">
              <CheckCircle className="w-5 h-5 text-orange-600 mb-2" />
              <p className="font-semibold text-orange-900">Tratamento de Erros</p>
              <p className="text-sm text-orange-700">Registra falhas para análise posterior</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Alert className="bg-amber-50 border-amber-200">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800">
          <strong>Importante:</strong> Depois de configurar o webhook no Gestor Visita, 
          teste enviando uma visita/estoque/troca e verifique em "Importações" se os dados foram recebidos corretamente.
        </AlertDescription>
      </Alert>
    </div>
  );
}