import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Prefetch das listas de apoio do PedidoFormulario (plano, tabela, cenários,
 * produtos, ações, motivos). Dispara UMA vez ao montar a tela-pai, com o MESMO
 * queryKey + cache usado no formulário — assim, quando o vendedor abre o 1º
 * cliente, plano/tabela/cenário já vêm do cache (instantâneo).
 *
 * Listas minúsculas que quase nunca mudam → staleTime 10min / gcTime 24h.
 */
export function usePrefetchApoioPedido() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const cache = { staleTime: 10 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000 };
    // Adiado ~500ms para não competir com a primeira busca de cliente do usuário.
    const t = setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: ['planosPagamento'],
        queryFn: () => base44.entities.PlanoPagamento.list('-created_date', 1000),
        ...cache,
      });
      queryClient.prefetchQuery({
        queryKey: ['tabelasPreco'],
        queryFn: () => base44.entities.TabelaPreco.list('-created_date', 1000),
        ...cache,
      });
      queryClient.prefetchQuery({
        queryKey: ['cenariosFiscaisLocais'],
        queryFn: () => base44.entities.CenarioFiscalLocal.filter({ status: 'ativo' }),
        ...cache,
      });
      queryClient.prefetchQuery({
        queryKey: ['produtos'],
        queryFn: () => base44.entities.Produto.filter({ status: 'ativo' }),
        ...cache,
      });
      queryClient.prefetchQuery({
        queryKey: ['acoesPromocionais'],
        queryFn: () => base44.entities.AcaoPromocional.list(),
        ...cache,
      });
      queryClient.prefetchQuery({
        queryKey: ['motivosTroca'],
        queryFn: () => base44.entities.MotivoTroca.list(),
        ...cache,
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}