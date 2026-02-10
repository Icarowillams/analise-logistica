import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export function useOmiePermissao() {
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => base44.entities.Permissao.list()
  });

  const isAdmin = currentUser?.role === 'admin';

  if (isAdmin) return true;

  const funcionario = vendedores.find(v => v.email?.toLowerCase() === currentUser?.email?.toLowerCase());
  if (!funcionario) return false;

  const perm = permissoes.find(p => p.vendedor_id === funcionario.id);
  return perm?.permissoes_cadastros?.importar_atualizar_omie || false;
}