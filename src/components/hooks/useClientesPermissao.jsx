import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Hook para filtrar dados baseado na permissão de visibilidade do usuário
 * 
 * Regras:
 * - visibilidade_clientes = 'todos': vê todos os dados
 * - visibilidade_clientes = 'base': 
 *   - Só vê dados (clientes, visitas, estoques, trocas, vendas) relacionados aos clientes da sua base
 *   - Vendedor/Promotor: clientes vinculados a ele ou nos seus roteiros
 *   - Supervisor: clientes dos vendedores que ele supervisiona
 * - Admin: sempre vê todos
 * 
 * IMPORTANTE: O filtro é baseado em CLIENTES DA BASE, não em quem executou a ação.
 * Ex: Se um promotor visita um cliente da minha base, eu vejo essa visita.
 * Se um promotor visita um cliente que NÃO é da minha base, eu NÃO vejo essa visita.
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

  // IDs dos clientes que o usuário pode ver (BASE DE CLIENTES)
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
      // Clientes vinculados aos vendedores supervisionados
      clientes.forEach(c => {
        if (c.vendedor_id === vendedor.id) {
          idsPermitidos.add(c.id);
        }
      });

      // Clientes nos roteiros dos vendedores supervisionados
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

  // Função para filtrar qualquer registro por cliente_id
  // Isso inclui: visitas, estoques, trocas, vendas - QUALQUER dado vinculado a um cliente
  const filtrarPorCliente = (lista, campoClienteId = 'cliente_id') => {
    if (clientesPermitidosIds === null) {
      return lista;
    }
    return lista.filter(item => {
      const clienteId = item[campoClienteId];
      // Se não tem cliente_id, não mostra (para garantir que dados órfãos não apareçam)
      if (!clienteId) return false;
      return clientesPermitidosIds.has(clienteId);
    });
  };

  // IDs de vendedores permitidos (o próprio funcionário + supervisionados)
  // Usado para filtros de seleção de vendedores na interface
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

  // Função para filtrar roteiros - mostra apenas roteiros com clientes da base
  const filtrarRoteiros = (listaRoteiros) => {
    if (clientesPermitidosIds === null) {
      return listaRoteiros;
    }
    return listaRoteiros.filter(roteiro => {
      // Verifica se pelo menos um cliente do roteiro está na base permitida
      const clientesDoRoteiro = roteiro.clientes_ids || [];
      return clientesDoRoteiro.some(clienteId => clientesPermitidosIds.has(clienteId));
    }).map(roteiro => {
      // Filtra os clientes_ids para mostrar apenas os permitidos
      return {
        ...roteiro,
        clientes_ids: (roteiro.clientes_ids || []).filter(id => clientesPermitidosIds.has(id)),
        clientes_detalhes: (roteiro.clientes_detalhes || []).filter(d => clientesPermitidosIds.has(d.cliente_id))
      };
    });
  };

  // Função para filtrar por vendedor (usado em selects da interface)
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
    filtrarRoteiros,
    clientes: clientesPermitidosIds === null ? clientes : clientes.filter(c => clientesPermitidosIds.has(c.id)),
    loading: !currentUser
  };
}