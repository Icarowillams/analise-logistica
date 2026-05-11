import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle, Webhook, Repeat, Send } from 'lucide-react';

// Painel de saúde da integração Omie — mostra status do webhook, automations e última sincronização.
// Lê LogIntegracaoOmie para verificar quando o webhook foi disparado pela última vez.

const formatRelativeTime = (date) => {
  if (!date) return 'nunca';
  const diff = Date.now() - new Date(date).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)} dias`;
};

const StatusRow = ({ icon: Icon, titulo, descricao, status, detalhe }) => {
  const cores = {
    ok: { bg: 'bg-green-50', border: 'border-green-200', iconColor: 'text-green-600', badge: 'bg-green-100 text-green-700 border-green-300' },
    warn: { bg: 'bg-amber-50', border: 'border-amber-200', iconColor: 'text-amber-600', badge: 'bg-amber-100 text-amber-700 border-amber-300' },
    erro: { bg: 'bg-red-50', border: 'border-red-200', iconColor: 'text-red-600', badge: 'bg-red-100 text-red-700 border-red-300' },
    inativo: { bg: 'bg-slate-50', border: 'border-slate-200', iconColor: 'text-slate-500', badge: 'bg-slate-100 text-slate-600 border-slate-300' }
  };
  const StatusIcon = status === 'ok' ? CheckCircle2 : status === 'erro' ? XCircle : AlertTriangle;
  const c = cores[status] || cores.inativo;

  return (
    <div className={`p-3 rounded-lg border ${c.bg} ${c.border} flex items-start gap-3`}>
      <Icon className={`w-5 h-5 mt-0.5 ${c.iconColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="font-semibold text-slate-900 text-sm">{titulo}</p>
          <Badge className={c.badge}>
            <StatusIcon className="w-3 h-3 mr-1" />
            {status === 'ok' ? 'Operacional' : status === 'erro' ? 'Falha' : status === 'warn' ? 'Atenção' : 'Inativo'}
          </Badge>
        </div>
        <p className="text-xs text-slate-600 mt-0.5">{descricao}</p>
        {detalhe && <p className="text-xs text-slate-500 mt-1 font-mono">{detalhe}</p>}
      </div>
    </div>
  );
};

export default function SaudeIntegracaoOmie() {
  const { data: logs = [] } = useQuery({
    queryKey: ['logsOmieSaude'],
    queryFn: () => base44.entities.LogIntegracaoOmie.list('-created_date', 100),
    refetchInterval: 30000
  });

  const saude = useMemo(() => {
    const agora = Date.now();
    const ultimas24h = logs.filter(l => agora - new Date(l.created_date).getTime() < 24 * 60 * 60 * 1000);

    // Webhook
    const ultimoWebhook = logs.find(l => l.endpoint === 'webhook');
    const webhookRecente = ultimoWebhook && (agora - new Date(ultimoWebhook.created_date).getTime() < 24 * 60 * 60 * 1000);

    // Última sync de pedidos
    const ultimaSyncPedidos = logs.find(l => l.operacao === 'sincronizar_status_pedidos' || l.call === 'ConsultarPedido');
    // Última sync de cargas
    const ultimaSyncCargas = logs.find(l => l.operacao === 'sincronizar_status_cargas');

    // Erros recentes
    const erros24h = ultimas24h.filter(l => l.status === 'erro').length;
    const sucessos24h = ultimas24h.filter(l => l.status === 'sucesso').length;
    const taxaSucesso = ultimas24h.length ? Math.round((sucessos24h / ultimas24h.length) * 100) : 100;

    return {
      ultimoWebhook,
      webhookRecente,
      ultimaSyncPedidos,
      ultimaSyncCargas,
      erros24h,
      taxaSucesso,
      total24h: ultimas24h.length
    };
  }, [logs]);

  const statusWebhook = saude.webhookRecente ? 'ok' : (saude.ultimoWebhook ? 'warn' : 'inativo');
  const statusGeral = saude.taxaSucesso >= 95 ? 'ok' : saude.taxaSucesso >= 80 ? 'warn' : 'erro';

  return (
    <Card className="border-2 border-cyan-100">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          Saúde da Integração
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusRow
          icon={Webhook}
          titulo="Webhook Omie → Base44"
          descricao={
            statusWebhook === 'ok'
              ? 'Recebendo eventos em tempo real do Omie'
              : statusWebhook === 'warn'
              ? 'Sem eventos há mais de 24h — verifique se o Omie ainda envia'
              : 'Não configurado — cadastre OMIE_WEBHOOK_TOKEN e a URL no painel do Omie'
          }
          status={statusWebhook}
          detalhe={saude.ultimoWebhook ? `Último evento: ${formatRelativeTime(saude.ultimoWebhook.created_date)} · ${saude.ultimoWebhook.call}` : 'URL: /functions/receberWebhookOmie?token=SEU_TOKEN'}
        />

        <StatusRow
          icon={Repeat}
          titulo="Sync Pedidos (a cada 15min)"
          descricao="Backup automático — detecta cancelamentos no Omie de pedidos faturados"
          status="ok"
          detalhe={saude.ultimaSyncPedidos ? `Última execução: ${formatRelativeTime(saude.ultimaSyncPedidos.created_date)}` : 'Aguardando primeira execução (em até 15 min)'}
        />

        <StatusRow
          icon={Repeat}
          titulo="Sync Cargas (a cada 30min)"
          descricao="Recalcula status das cargas com base nos pedidos no Omie"
          status="ok"
          detalhe={saude.ultimaSyncCargas ? `Última execução: ${formatRelativeTime(saude.ultimaSyncCargas.created_date)}` : 'Aguardando primeira execução (em até 30 min)'}
        />

        <StatusRow
          icon={Send}
          titulo="Auto-envio de Clientes e Produtos"
          descricao="Cria/atualiza no Omie automaticamente quando salvos no Base44"
          status="ok"
          detalhe="Entity automations ativas: Cliente (create/update), Produto (create/update/delete)"
        />

        {/* Taxa de sucesso geral */}
        <div className={`p-3 rounded-lg border-2 mt-4 ${statusGeral === 'ok' ? 'border-green-300 bg-green-50' : statusGeral === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-red-300 bg-red-50'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase font-semibold text-slate-600">Taxa de sucesso (24h)</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">{saude.taxaSucesso}%</p>
            </div>
            <div className="text-right text-xs text-slate-600">
              <p>{saude.total24h} chamadas</p>
              <p className="text-red-600 font-semibold">{saude.erros24h} erros</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}