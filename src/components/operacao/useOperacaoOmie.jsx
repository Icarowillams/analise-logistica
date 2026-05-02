import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

// Hook único que orquestra TUDO da Operação:
// - busca todas as etapas em paralelo (10/20/50/60)
// - enriquece cada lista com cliente/vendedor/rota
// - retorna lastUpdate para mostrar "atualizado há Xs"
// - auto-refresh opcional

const STALE = 15000;
const REFRESH_AUTO = 30000;

async function fetchEtapa(etapa) {
  const { data } = await base44.functions.invoke('buscarPedidosOmie', {
    etapa,
    registros_por_pagina: 100,
    buscar_todas_paginas: true,
    incluir_cancelados: false
  });
  return data?.pedidos || [];
}

async function fetchFaturados() {
  const { data } = await base44.functions.invoke('consultarStatusFaturamentoOmie', {
    registros_por_pagina: 100,
    buscar_todas_paginas: true,
    incluir_cancelados: false
  });
  return data?.pedidos || [];
}

async function enriquecer(pedidos) {
  if (!pedidos || pedidos.length === 0) return [];
  const { data } = await base44.functions.invoke('enriquecerPedidosOperacao', { pedidos });
  return data?.pedidos || pedidos;
}

function buildQuery(etapa) {
  return {
    queryKey: ['operacaoOmie', etapa],
    queryFn: async () => {
      const crus = etapa === '60' ? await fetchFaturados() : await fetchEtapa(etapa);
      return enriquecer(crus);
    },
    staleTime: STALE,
    refetchOnWindowFocus: true
  };
}

export function useOperacaoOmie({ autoRefresh = true } = {}) {
  const queryClient = useQueryClient();
  const [lastFullUpdate, setLastFullUpdate] = useState(Date.now());

  const q10 = useQuery(buildQuery('10'));
  const q20 = useQuery(buildQuery('20'));
  const q50 = useQuery(buildQuery('50'));
  const q60 = useQuery(buildQuery('60'));

  useEffect(() => {
    if (q10.dataUpdatedAt && q20.dataUpdatedAt && q50.dataUpdatedAt && q60.dataUpdatedAt) {
      const max = Math.max(q10.dataUpdatedAt, q20.dataUpdatedAt, q50.dataUpdatedAt, q60.dataUpdatedAt);
      setLastFullUpdate(max);
    }
  }, [q10.dataUpdatedAt, q20.dataUpdatedAt, q50.dataUpdatedAt, q60.dataUpdatedAt]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['operacaoOmie'] });
    }, REFRESH_AUTO);
    return () => clearInterval(interval);
  }, [autoRefresh, queryClient]);

  const refetchAll = () => queryClient.refetchQueries({ queryKey: ['operacaoOmie'] });

  const queries = {
    '10': q10,
    '20': q20,
    '50': q50,
    '60': q60
  };

  const totalGeral = ['10', '20', '50', '60'].reduce((s, e) => s + (queries[e].data?.length || 0), 0);
  const valorGeral = ['10', '20', '50', '60'].reduce((s, e) => {
    return s + (queries[e].data || []).reduce((acc, p) => acc + (Number(p.valor_total_pedido) || 0), 0);
  }, 0);

  const isAnyLoading = q10.isFetching || q20.isFetching || q50.isFetching || q60.isFetching;

  return {
    queries,
    refetchAll,
    lastFullUpdate,
    isAnyLoading,
    totalGeral,
    valorGeral
  };
}