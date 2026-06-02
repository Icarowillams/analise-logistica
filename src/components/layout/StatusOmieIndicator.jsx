import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Wifi, WifiOff, ShieldAlert, ShieldCheck, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function formatTempo(segundos) {
  if (segundos <= 0) return '0s';
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  if (min === 0) return `${seg}s`;
  return `${min}min ${seg}s`;
}

function formatHora(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

export default function StatusOmieIndicator({ compact = false }) {
  const [modalAberto, setModalAberto] = useState(false);
  const [tempoRestante, setTempoRestante] = useState(0);

  const { data: status, isError } = useQuery({
    queryKey: ['omie-circuit-breaker'],
    queryFn: async () => {
      const { data } = await base44.functions.invoke('statusCircuitBreakerOmie', {});
      return data;
    },
    refetchInterval: 30000,
    staleTime: 10000,
    refetchOnWindowFocus: true
  });

  // Contador regressivo local (atualiza a cada segundo quando bloqueado)
  useEffect(() => {
    if (!status?.bloqueado || !status?.bloqueado_ate) {
      setTempoRestante(0);
      return;
    }
    const calcular = () => {
      const restante = Math.max(0, Math.ceil((new Date(status.bloqueado_ate).getTime() - Date.now()) / 1000));
      setTempoRestante(restante);
    };
    calcular();
    const timer = setInterval(calcular, 1000);
    return () => clearInterval(timer);
  }, [status?.bloqueado, status?.bloqueado_ate]);

  const bloqueado = status?.bloqueado && tempoRestante > 0;
  const tipo = status?.tipo || 'OK';
  const isMisuse = tipo === 'MISUSE';
  const isRateLimit = tipo === 'RATE_LIMIT';
  const isOffline = isError;

  // Cores e ícones por estado
  let bgClass, textClass, dotClass, Icon, label, pulseClass = '';
  if (isOffline) {
    bgClass = 'bg-slate-700/60';
    textClass = 'text-slate-300';
    dotClass = 'bg-slate-400';
    Icon = WifiOff;
    label = 'Offline';
  } else if (bloqueado && isMisuse) {
    bgClass = 'bg-red-900/60';
    textClass = 'text-red-300';
    dotClass = 'bg-red-500';
    pulseClass = 'animate-pulse';
    Icon = ShieldAlert;
    label = `Bloqueado — ${formatTempo(tempoRestante)}`;
  } else if (bloqueado && isRateLimit) {
    bgClass = 'bg-amber-900/60';
    textClass = 'text-amber-300';
    dotClass = 'bg-amber-500';
    Icon = Clock;
    label = `Limitado — ${formatTempo(tempoRestante)}`;
  } else if (bloqueado) {
    bgClass = 'bg-orange-900/60';
    textClass = 'text-orange-300';
    dotClass = 'bg-orange-500';
    Icon = ShieldAlert;
    label = `Bloqueado — ${formatTempo(tempoRestante)}`;
  } else {
    bgClass = 'bg-emerald-900/40';
    textClass = 'text-emerald-300';
    dotClass = 'bg-emerald-500';
    Icon = ShieldCheck;
    label = 'Online';
  }

  return (
    <>
      <button
        onClick={() => bloqueado && setModalAberto(true)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all ${bgClass} ${textClass} ${bloqueado ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        title={bloqueado ? 'Clique para ver detalhes' : `API Omie ${label}`}
      >
        <span className={`w-2 h-2 rounded-full ${dotClass} ${pulseClass}`} />
        {!compact && (
          <>
            <Icon className="w-3 h-3" />
            <span className="hidden sm:inline">{label}</span>
          </>
        )}
      </button>

      {/* Modal de detalhes */}
      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className={`w-5 h-5 ${isMisuse ? 'text-red-500' : 'text-amber-500'}`} />
              API Omie {isMisuse ? 'Bloqueada' : 'Limitada'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-slate-50 border rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Tipo</span>
                <span className="font-medium">{tipo === 'MISUSE' ? 'MISUSE_API_PROCESS' : tipo === 'RATE_LIMIT' ? 'Rate Limit (429)' : 'Bloqueio genérico'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Desbloqueio em</span>
                <span className="font-medium">{formatHora(status?.bloqueado_ate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tempo restante</span>
                <span className="font-bold text-base">{formatTempo(tempoRestante)}</span>
              </div>
              {status?.ultimo_erro && (
                <div className="pt-2 border-t">
                  <span className="text-slate-500 text-xs">Erro:</span>
                  <p className="text-xs text-red-600 mt-1 break-words">{status.ultimo_erro}</p>
                </div>
              )}
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm font-medium text-red-800 mb-2">Ações que NÃO funcionam agora:</p>
              <ul className="text-xs text-red-700 space-y-1 list-disc list-inside">
                <li>Enviar pedidos ao Omie</li>
                <li>Emitir notas fiscais</li>
                <li>Emitir/consultar boletos</li>
                <li>Sincronizar status de pedidos</li>
                <li>Faturar cargas</li>
              </ul>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm font-medium text-green-800 mb-2">Ações que ainda funcionam:</p>
              <ul className="text-xs text-green-700 space-y-1 list-disc list-inside">
                <li>Digitar pedidos localmente</li>
                <li>Montar cargas</li>
                <li>Relatórios internos</li>
                <li>Cadastros locais (clientes, produtos)</li>
              </ul>
            </div>
          </div>

          <Button variant="outline" onClick={() => setModalAberto(false)} className="w-full">
            Fechar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}