import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Hook que retorna os IDs dos produtos do mix de um cliente.
 * Combina produtos individuais + produtos dos grupos vinculados.
 * Se o cliente não tem mix cadastrado, retorna null (sem filtro).
 */
export function useMixCliente(clienteId, clienteCodigo) {
  const { data: mixClientes = [] } = useQuery({
    queryKey: ['mixClientes'],
    queryFn: () => base44.entities.MixCliente.list()
  });

  const { data: gruposMix = [] } = useQuery({
    queryKey: ['gruposMix'],
    queryFn: () => base44.entities.GrupoMix.list()
  });

  const mixDoCliente = useMemo(() => {
    if (!clienteId && !clienteCodigo) return null;

    const mix = mixClientes.find(m =>
      (clienteCodigo && m.cliente_codigo === clienteCodigo) ||
      m.cliente_id === clienteId
    );

    if (!mix) return null;

    const produtosIds = new Set(mix.produtos_ids || []);

    // Adicionar produtos dos grupos vinculados
    (mix.grupos_ids || []).forEach(grupoId => {
      const grupo = gruposMix.find(g => g.id === grupoId && g.status === 'ativo');
      if (grupo) {
        (grupo.produtos_ids || []).forEach(pid => produtosIds.add(pid));
      }
    });

    return produtosIds.size > 0 ? produtosIds : null;
  }, [clienteId, clienteCodigo, mixClientes, gruposMix]);

  return mixDoCliente;
}