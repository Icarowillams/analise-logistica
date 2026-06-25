import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import useDebounce from '@/hooks/useDebounce';

/**
 * Busca server-side de clientes — usada nos modais de busca.
 * Não carrega NADA até o usuário digitar ao menos `minChars` (padrão 2).
 * Pesquisa por nome (razao_social / nome_fantasia) com filter_type 'like',
 * limitado a `limite` resultados (padrão 30). Debounce de 300ms já embutido.
 *
 * Retorna { clientes, isFetching, termoAtivo } — termoAtivo indica se já há busca em andamento.
 */
export default function useBuscaClientes(termo, { minChars = 2, limite = 30, extraFilter = {} } = {}) {
  const termoDebounced = useDebounce((termo || '').trim(), 300);
  const ativo = termoDebounced.length >= minChars;

  // Server-side: tenta por nome_fantasia e razao_social (like) e por código exato, e mescla.
  const { data: clientes = [], isFetching } = useQuery({
    queryKey: ['busca-clientes-server', termoDebounced, limite, JSON.stringify(extraFilter)],
    queryFn: async () => {
      const base = { ...extraFilter };
      const [porFantasia, porRazao, porCodigoExato, porCodigoParcial, porCodigoInteg] = await Promise.all([
        base44.entities.Cliente.filter({ ...base, nome_fantasia: { $regex: termoDebounced, $options: 'i' } }, '-created_date', limite).catch(() => []),
        base44.entities.Cliente.filter({ ...base, razao_social: { $regex: termoDebounced, $options: 'i' } }, '-created_date', limite).catch(() => []),
        base44.entities.Cliente.filter({ ...base, codigo_interno: termoDebounced }, '-created_date', 5).catch(() => []),
        base44.entities.Cliente.filter({ ...base, codigo_interno: { $regex: termoDebounced, $options: 'i' } }, '-created_date', limite).catch(() => []),
        base44.entities.Cliente.filter({ ...base, codigo_integracao: { $regex: termoDebounced, $options: 'i' } }, '-created_date', limite).catch(() => []),
      ]);
      const mapa = new Map();
      [...porCodigoExato, ...porCodigoParcial, ...porCodigoInteg, ...porFantasia, ...porRazao].forEach(c => { if (c && !mapa.has(c.id)) mapa.set(c.id, c); });
      return Array.from(mapa.values()).slice(0, limite);
    },
    enabled: ativo,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return { clientes, isFetching: ativo && isFetching, termoAtivo: ativo };
}