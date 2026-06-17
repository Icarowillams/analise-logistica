import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { RefreshCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// Botão manual (ação humana, sem automação) para re-sincronizar a etapa Omie dos
// pedidos de venda de uma carga que ficaram com a etapa divergente após um REDUNDANT.
// Reexecuta TrocarEtapaPedido espaçado (a função trocarEtapaPedidoOmie já processa
// sequencialmente, com intervalo entre chamadas e retry de REDUNDANT/425/429).
// NÃO altera o campo interno do pedido — apenas reenvia a etapa ao Omie.
export default function RevalidarEtapaOmieButton({ carga, etapaDestino = '20', onConcluido }) {
  const [carregando, setCarregando] = useState(false);

  const pedidosOmie = (carga?.pedidos_omie || []).filter(p => p.codigo_pedido || p.codigo_pedido_integracao);

  if (pedidosOmie.length === 0) return null;

  const revalidar = async () => {
    if (!confirm(`Re-sincronizar a etapa (${etapaDestino}) de ${pedidosOmie.length} pedido(s) da carga ${carga.numero_carga} no Omie?\n\nO envio é espaçado para evitar bloqueio do Omie e pode levar alguns segundos.`)) return;
    setCarregando(true);
    try {
      const { data } = await base44.functions.invoke('trocarEtapaPedidoOmie', {
        pedidos: pedidosOmie.map(p => ({
          codigo_pedido: p.codigo_pedido,
          codigo_pedido_integracao: p.codigo_pedido_integracao,
          numero_pedido: p.numero_pedido,
          etapa: etapaDestino
        }))
      });
      if (data?.omie_bloqueada) {
        toast.warning('API Omie temporariamente bloqueada. Tente novamente em alguns minutos.');
      } else {
        const ok = data?.sucessos ?? 0;
        const fail = data?.erros ?? 0;
        if (fail === 0) {
          toast.success(`Etapa re-sincronizada: ${ok} pedido(s) OK.`);
        } else {
          const pendentes = (data?.resultados || [])
            .filter(r => !r.sucesso)
            .map(r => r.numero_pedido || r.codigo_pedido)
            .join(', ');
          toast.warning(`${ok} OK, ${fail} pendente(s) (Omie ocupado): ${pendentes}. Tente novamente em 1 min.`, { duration: 9000 });
        }
      }
      onConcluido?.();
    } catch (e) {
      toast.error(e.message);
    }
    setCarregando(false);
  };

  return (
    <Button
      size="icon"
      variant="outline"
      className="h-7 w-7 border-purple-300 text-purple-700 hover:bg-purple-50"
      onClick={revalidar}
      disabled={carregando}
      title="Re-sincronizar etapa dos pedidos no Omie (corrige divergência após REDUNDANT)"
    >
      {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
    </Button>
  );
}