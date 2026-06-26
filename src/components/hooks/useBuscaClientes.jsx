import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import useDebounce from '@/hooks/useDebounce';

/**
 * Busca server-side de clientes — usada nos modais e no Pedido Avulso.
 * Não carrega NADA até o usuário digitar ao menos `minChars` (padrão 2).
 *
 * UMA ÚNICA query com $or cobrindo nome (razao_social / nome_fantasia) e TODOS os
 * campos de código (codigo, codigo_interno, codigo_integracao, codigo_omie).
 * Antes eram 9 requisições paralelas por busca — isso estourava o rate limit no
 * navegador (em conexões de celular/lentas), deixando o spinner infinito e a lista
 * "sem resultados" mesmo com o cliente existindo. Uma só chamada resolve.
 *
 * Retorna { clientes, isFetching, termoAtivo } — termoAtivo indica se já há busca em andamento.
 */
export default function useBuscaClientes(termo, { minChars = 2, limite = 30, extraFilter = {} } = {}) {
  const termoDebounced = useDebounce((termo || '').trim(), 300);
  const ativo = termoDebounced.length >= minChars;

  const { data: clientes = [], isFetching } = useQuery({
    queryKey: ['busca-clientes-server', termoDebounced, limite, JSON.stringify(extraFilter)],
    queryFn: () => base44.entities.Cliente.filter({
      ...extraFilter,
      $or: [
        { razao_social: { $regex: termoDebounced, $options: 'i' } },
        { nome_fantasia: { $regex: termoDebounced, $options: 'i' } },
        { codigo: { $regex: termoDebounced, $options: 'i' } },
        { codigo_interno: { $regex: termoDebounced, $options: 'i' } },
        { codigo_integracao: { $regex: termoDebounced, $options: 'i' } },
        { codigo_omie: { $regex: termoDebounced, $options: 'i' } },
      ],
    }, '-created_date', limite),
    enabled: ativo,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  return { clientes, isFetching: ativo && isFetching, termoAtivo: ativo };
}