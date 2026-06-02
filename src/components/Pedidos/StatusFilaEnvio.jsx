import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, Clock, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const STATUS_CONFIG = {
  pendente: { label: 'Na fila', icon: Clock, className: 'bg-amber-100 text-amber-800 border-amber-300' },
  processando: { label: 'Enviando...', icon: Loader2, className: 'bg-blue-100 text-blue-800 border-blue-300', spin: true },
  concluido: { label: 'Enviado', icon: CheckCircle2, className: 'bg-green-100 text-green-800 border-green-300' },
  erro: { label: 'Erro', icon: AlertCircle, className: 'bg-red-100 text-red-800 border-red-300' }
};

export default function StatusFilaEnvio({ filaItem }) {
  if (!filaItem) return null;

  const config = STATUS_CONFIG[filaItem.status] || STATUS_CONFIG.pendente;
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`text-[10px] gap-1 cursor-help ${config.className}`}>
            <Icon className={`w-3 h-3 ${config.spin ? 'animate-spin' : ''}`} />
            {config.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px] text-xs">
          {filaItem.status === 'pendente' && (
            <span>Aguardando processamento em background. O pedido será enviado automaticamente.</span>
          )}
          {filaItem.status === 'processando' && (
            <span>Enviando ao Omie neste momento...</span>
          )}
          {filaItem.status === 'concluido' && (
            <span>Enviado com sucesso. Código Omie: {filaItem.codigo_pedido_omie || '-'}</span>
          )}
          {filaItem.status === 'erro' && (
            <span>Erro: {filaItem.erro_log || 'Erro desconhecido'} (tentativas: {filaItem.tentativas}/3)</span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}