import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Ban } from 'lucide-react';

// Alerta visual grande exibido no topo da tela Integração Omie quando a API
// está bloqueada por rate limit (circuit breaker ativo). Mostra contagem
// regressiva até o desbloqueio. Não renderiza nada se a API estiver liberada.
export default function AlertaBloqueioOmie() {
  const { data: controles = [] } = useQuery({
    queryKey: ['controleCircuitBreakerOmie'],
    queryFn: () => base44.entities.ControleCircuitBreakerOmie.list('-updated_date', 10),
    refetchInterval: 15000
  });

  const bloqueio = useMemo(() => {
    const agora = Date.now();
    const breaker = (controles || []).find(c => c.chave === 'principal');
    const bloqueadoAte = breaker?.bloqueado_ate ? new Date(breaker.bloqueado_ate).getTime() : 0;
    const bloqueado = Boolean(breaker?.bloqueado) && bloqueadoAte > agora;
    return {
      bloqueado,
      minutos: bloqueado ? Math.max(1, Math.ceil((bloqueadoAte - agora) / 60000)) : 0,
      ultimoErro: breaker?.ultimo_erro || ''
    };
  }, [controles]);

  if (!bloqueio.bloqueado) return null;

  return (
    <Card className="border-2 border-red-400 bg-red-50">
      <CardContent className="flex items-center gap-4 pt-5">
        <div className="rounded-xl bg-red-100 p-3 text-red-600 animate-pulse">
          <Ban className="h-7 w-7" />
        </div>
        <div className="flex-1">
          <p className="text-lg font-bold text-red-900">API Omie bloqueada por rate limit</p>
          <p className="text-sm text-red-800 mt-0.5">
            Próxima tentativa permitida em <strong>{bloqueio.minutos} minuto(s)</strong>. As sincronizações estão pausadas automaticamente.
          </p>
          {bloqueio.ultimoErro && (
            <p className="text-xs text-red-700 mt-1 font-mono">{bloqueio.ultimoErro.slice(0, 140)}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}