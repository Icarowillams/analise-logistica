import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Hook para filtrar clientes baseado na permissão de visibilidade do usuário
 * 
 * Regras:
 * - visibilidade_clientes = 'todos': vê todos os clientes
 * - visibilidade_clientes = 'base': 
 *   - Vendedor/Promotor: vê apenas clientes vinculados a ele (vendedor_id) ou nos seus roteiros
 *   - Supervisor: vê clientes dos vendedores que ele supervisiona
 * - Admin: sempre vê todos
 */
export function useClientesPermissao() {
  const [currentUser, setCurrentUser] = useState(null);
  const [funcionarioAtual, setFuncionarioAtual] = useState(null);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => base44.entities.Permissao.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteiros'],
    queryFn: () => base44.entities.Roteiro.list()
  });

  useEffect(() => {
    base44.auth.me().then(user => {
      setCurrentUser(user);
      const funcionario = vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
      setFuncionarioAtual(funcionario);
    }).catch(() => {});
  }, [vendedores]);

  const permissaoUsuario = useMemo(() => {
    if (!funcionarioAtual) return null;
    return permissoes.find(p => p.vendedor_id === funcionarioAtual.id);
  }, [permissoes, funcionarioAtual]);

  const isAdmin = currentUser?.role === 'admin';

  // IDs dos clientes que o usuário pode ver
  const clientesPermitidosIds = useMemo(() => {
    // Admin sempre vê tudo
    if (isAdmin) {
      return null; // null significa sem filtro
    }

    // Se não tem permissão definida ou visibilidade é 'todos', vê tudo
    if (!permissaoUsuario || permissaoUsuario.visibilidade_clientes !== 'base') {
      return null;
    }

    // Visibilidade = 'base'
    if (!funcionarioAtual) {
      return new Set();
    }

    const idsPermitidos = new Set();

    // 1. Clientes vinculados diretamente ao funcionário (vendedor_id)
    clientes.forEach(c => {
      if (c.vendedor_id === funcionarioAtual.id) {
        idsPermitidos.add(c.id);
      }
    });

    // 2. Clientes nos roteiros do funcionário
    roteiros.forEach(r => {
      if (r.vendedor_id === funcionarioAtual.id) {
        (r.clientes_ids || []).forEach(id => idsPermitidos.add(id));
      }
    });

    // 3. Se é supervisor: clientes dos vendedores que ele supervisiona
    const vendedoresSupervisionados = vendedores.filter(v => v.supervisor_id === funcionarioAtual.id);
    vendedoresSupervisionados.forEach(vendedor => {
      // Clientes vinculados aos vendedores
      clientes.forEach(c => {
        if (c.vendedor_id === vendedor.id) {
          idsPermitidos.add(c.id);
        }
      });

      // Clientes nos roteiros dos vendedores
      roteiros.forEach(r => {
        if (r.vendedor_id === vendedor.id) {
          (r.clientes_ids || []).forEach(id => idsPermitidos.add(id));
        }
      });
    });

    return idsPermitidos;
  }, [isAdmin, permissaoUsuario, funcionarioAtual, clientes, roteiros, vendedores]);

  // Função para filtrar clientes
  const filtrarClientes = (listaClientes) => {
    if (clientesPermitidosIds === null) {
      return listaClientes;
    }
    return listaClientes.filter(c => clientesPermitidosIds.has(c.id));
  };

  // Função para verificar se um cliente específico é permitido
  const clientePermitido = (clienteId) => {
    if (clientesPermitidosIds === null) return true;
    return clientesPermitidosIds.has(clienteId);
  };

  // Função para filtrar vendas/trocas/registros por cliente
  const filtrarPorCliente = (lista, campoClienteId = 'cliente_id') => {
    if (clientesPermitidosIds === null) {
      return lista;
    }
    return lista.filter(item => clientesPermitidosIds.has(item[campoClienteId]));
  };

  // IDs de vendedores permitidos (para filtrar vendas, etc)
  const vendedoresPermitidosIds = useMemo(() => {
    if (isAdmin) return null;
    if (!permissaoUsuario || permissaoUsuario.visibilidade_clientes !== 'base') return null;
    if (!funcionarioAtual) return new Set();

    const ids = new Set([funcionarioAtual.id]);
    
    // Adicionar vendedores supervisionados
    vendedores.forEach(v => {
      if (v.supervisor_id === funcionarioAtual.id) {
        ids.add(v.id);
      }
    });

    return ids;
  }, [isAdmin, permissaoUsuario, funcionarioAtual, vendedores]);

  // Função para filtrar por vendedor
  const filtrarPorVendedor = (lista, campoVendedorId = 'vendedor_id') => {
    if (vendedoresPermitidosIds === null) return lista;
    return lista.filter(item => vendedoresPermitidosIds.has(item[campoVendedorId]));
  };

  return {
    currentUser,
    funcionarioAtual,
    permissaoUsuario,
    isAdmin,
    clientesPermitidosIds,
    vendedoresPermitidosIds,
    filtrarClientes,
    clientePermitido,
    filtrarPorCliente,
    filtrarPorVendedor,
    clientes: clientesPermitidosIds === null ? clientes : clientes.filter(c => clientesPermitidosIds.has(c.id)),
    loading: !currentUser
  };
}