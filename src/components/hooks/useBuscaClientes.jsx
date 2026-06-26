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

  // Server-side: tenta por nome_fantasia e razao_social (like) e por código (interno/integração/omie), e mescla.
  const { data: clientes = [], isFetching } = useQuery({
    queryKey: ['busca-clientes-server', termoDebounced, limite, JSON.stringify(extraFilter)],
    queryFn: async () => {
      const base = { ...extraFilter };
      // Cada sub-busca rastreia se FALHOU (não apenas "veio vazia"). Assim, se TODAS falharem
      // (ex.: timeout/rede), lançamos erro para o React Query refazer — em vez de cachear um
      // resultado vazio por 60s, que fazia o cliente "sumir" mesmo existindo.
      let falhas = 0;
      const tentar = async (p) => { try { return await p; } catch { falhas++; return []; } };
      const [porFantasia, porRazao, porCodigoExato, porCodigoParcial, porCodigoInteg, porCodigoOmie, porCodOmieExato] = await Promise.all([
        tentar(base44.entities.Cliente.filter({ ...base, nome_fantasia: { $regex: termoDebounced, $options: 'i' } }, '-created_date', limite)),
        tentar(base44.entities.Cliente.filter({ ...base, razao_social: { $regex: termoDebounced, $options: 'i' } }, '-created_date', limite)),
        tentar(base44.entities.Cliente.filter({ ...base, codigo_interno: termoDebounced }, '-created_date', 5)),
        tentar(base44.entities.Cliente.filter({ ...base, codigo_interno: { $regex: termoDebounced, $options: 'i' } }, '-created_date', limite)),
        tentar(base44.entities.Cliente.filter({ ...base, codigo_integracao: { $regex: termoDebounced, $options: 'i' } }, '-created_date', limite)),
        tentar(base44.entities.Cliente.filter({ ...base, codigo_omie: { $regex: termoDebounced, $options: 'i' } }, '-created_date', limite)),
        tentar(base44.entities.Cliente.filter({ ...base, codigo_omie: termoDebounced }, '-created_date', 5)),
      ]);
      // Se TODAS as 7 sub-buscas falharam, é falha de rede — propaga para refazer (não cacheia vazio).
      if (falhas === 7) throw new Error('Falha ao buscar clientes — tentando novamente');
      const mapa = new Map();
      [...porCodigoExato, ...porCodOmieExato, ...porCodigoParcial, ...porCodigoInteg, ...porCodigoOmie, ...porFantasia, ...porRazao].forEach(c => { if (c && !mapa.has(c.id)) mapa.set(c.id, c); });
      return Array.from(mapa.values()).slice(0, limite);
    },
    enabled: ativo,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  return { clientes, isFetching: ativo && isFetching, termoAtivo: ativo };
}