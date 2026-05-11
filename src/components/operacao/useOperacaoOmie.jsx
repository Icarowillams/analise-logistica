import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

// 🔄 Hook 100% WEBHOOK-DRIVEN da Operação
// - Lê do espelho local PedidoLiberadoOmie (atualizado em tempo real pelos webhooks Omie)
// - ZERO chamadas Omie no fluxo normal
// - Real-time via base44.entities.PedidoLiberadoOmie.subscribe()
// - refetchAll() dispara reconciliação backend (bootstrapPedidosLiberadosOmie) — uso manual apenas

const ETAPAS = ['10', '20', '50', '60'];

async function listarEspelho() {
  // Carrega todo o espelho local — paginado se passar do limite
  return await base44.entities.PedidoLiberadoOmie.list('-sincronizado_em', 5000);
}

export function useOperacaoOmie() {
  const queryClient = useQueryClient();
  const [lastFullUpdate, setLastFullUpdate] = useState(Date.now());

  const espelhoQuery = useQuery({
    queryKey: ['operacaoEspelho'],
    queryFn: listarEspelho,
    staleTime: 60000,
    refetchOnWindowFocus: false
  });

  // Atualização em tempo real via subscribe
  useEffect(() => {
    const unsubscribe = base44.entities.PedidoLiberadoOmie.subscribe((event) => {
      queryClient.setQueryData(['operacaoEspelho'], (old) => {
        const lista = Array.isArray(old) ? old : [];
        if (event.type === 'create') {
          if (lista.some(p => p.id === event.data.id)) return lista;
          return [event.data, ...lista];
        }
        if (event.type === 'update') {
          return lista.map(p => p.id === event.id ? { ...p, ...event.data } : p);
        }
        if (event.type === 'delete') {
          return lista.filter(p => p.id !== event.id);
        }
        return lista;
      });
      setLastFullUpdate(Date.now());
    });
    return () => { try { unsubscribe?.(); } catch {} };
  }, [queryClient]);

  useEffect(() => {
    if (espelhoQuery.dataUpdatedAt) setLastFullUpdate(espelhoQuery.dataUpdatedAt);
  }, [espelhoQuery.dataUpdatedAt]);

  // Agrupar por etapa
  const espelho = espelhoQuery.data || [];
  const porEtapa = {
    '10': espelho.filter(p => String(p.etapa) === '10'),
    '20': espelho.filter(p => String(p.etapa) === '20'),
    '50': espelho.filter(p => String(p.etapa) === '50'),
    '60': espelho.filter(p => String(p.etapa) === '60')
  };

  // Dispara reconciliação backend (busca tudo do Omie e atualiza o espelho)
  const refetchAll = async () => {
    try {
      await base44.functions.invoke('bootstrapPedidosLiberadosOmie', { origem: 'reconciliacao', etapas: ETAPAS });
    } catch (e) {
      console.error('[useOperacaoOmie] reconciliação falhou:', e?.message);
    }
    return queryClient.refetchQueries({ queryKey: ['operacaoEspelho'] });
  };

  const queries = {
    '10': { data: porEtapa['10'], isLoading: espelhoQuery.isLoading, isFetching: espelhoQuery.isFetching },
    '20': { data: porEtapa['20'], isLoading: espelhoQuery.isLoading, isFetching: espelhoQuery.isFetching },
    '50': { data: porEtapa['50'], isLoading: espelhoQuery.isLoading, isFetching: espelhoQuery.isFetching },
    '60': { data: porEtapa['60'], isLoading: espelhoQuery.isLoading, isFetching: espelhoQuery.isFetching }
  };

  const totalGeral = espelho.length;
  const valorGeral = espelho.reduce((s, p) => s + (Number(p.valor_total_pedido) || 0), 0);
  const isAnyLoading = espelhoQuery.isFetching;

  return {
    queries,
    refetchAll,
    lastFullUpdate,
    isAnyLoading,
    totalGeral,
    valorGeral
  };
}