import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ShoppingCart } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DigitarPedido from '@/components/Pedidos/DigitarPedido';
import PedidoAvulso from '@/components/Pedidos/PedidoAvulso';
import EnvioPedidos from '@/components/Pedidos/EnvioPedidos';

export default function EmissaoPedidos() {
  const [currentUser, setCurrentUser] = useState(null);
  const [vendedorAtual, setVendedorAtual] = useState(null);
  const [activeTab, setActiveTab] = useState('digitar');
  const [editingPedidoId, setEditingPedidoId] = useState(null);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => base44.entities.Permissao.list()
  });

  const permissaoUsuario = useMemo(() => {
    if (!vendedorAtual) return null;
    return permissoes.find(p => p.vendedor_id === vendedorAtual.id);
  }, [vendedorAtual, permissoes]);

  const permissaoCenariosFiscais = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return permissaoUsuario?.permissoes_pedidos?.usar_cenarios_fiscais || false;
  }, [currentUser, permissaoUsuario]);

  const podePedidoAvulso = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return permissaoUsuario?.permissoes_pedidos?.pedido_avulso !== false;
  }, [currentUser, permissaoUsuario]);

  useEffect(() => {
    base44.auth.me().then(user => {
      setCurrentUser(user);
      const vendedor = vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
      setVendedorAtual(vendedor);
    }).catch(() => {});
  }, [vendedores]);

  const handleEditPedido = (pedidoId) => {
    setEditingPedidoId(pedidoId);
    setActiveTab('digitar');
  };

  const isAdmin = currentUser?.role === 'admin';

  if (!currentUser) {
    return (
      <div>
        <PageHeader title="Emissão de Pedidos" icon={ShoppingCart} />
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
        </div>
      </div>
    );
  }

  if (!vendedorAtual && !isAdmin) {
    return (
      <div>
        <PageHeader title="Emissão de Pedidos" icon={ShoppingCart} />
        <Alert>
          <AlertDescription>
            Você não está cadastrado como funcionário no sistema. Entre em contato com o administrador.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Para admins sem vendedor vinculado, criar um objeto vendedor temporário
  const vendedorEfetivo = vendedorAtual || (isAdmin ? {
    id: null,
    nome: currentUser.full_name || currentUser.email,
    email: currentUser.email
  } : null);

  return (
    <div>
      <PageHeader title="Emissão de Pedidos" subtitle={`Vendedor: ${vendedorEfetivo?.nome || '-'}`} icon={ShoppingCart} />
      
      <div>
        <div className={`inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground grid w-full ${podePedidoAvulso ? 'grid-cols-3' : 'grid-cols-2'} mb-6`}>
          <button
            onClick={() => { setActiveTab('digitar'); }}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${activeTab === 'digitar' ? 'bg-background text-foreground shadow' : ''}`}
          >
            Roteiro
          </button>
          {podePedidoAvulso && (
            <button
              onClick={() => { setActiveTab('avulso'); }}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${activeTab === 'avulso' ? 'bg-background text-foreground shadow' : ''}`}
            >
              Pedido Avulso
            </button>
          )}
          <button
            onClick={() => { setActiveTab('envio'); }}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${activeTab === 'envio' ? 'bg-background text-foreground shadow' : ''}`}
          >
            Envio
          </button>
        </div>

        <div style={{ display: activeTab === 'digitar' ? 'block' : 'none' }}>
          <DigitarPedido vendedor={vendedorEfetivo} editingPedidoId={editingPedidoId} onClearEdit={() => setEditingPedidoId(null)} permissaoCenariosFiscais={permissaoCenariosFiscais} />
        </div>

        <div style={{ display: activeTab === 'avulso' ? 'block' : 'none' }}>
          <PedidoAvulso vendedor={vendedorEfetivo} editingPedidoId={editingPedidoId} onClearEdit={() => setEditingPedidoId(null)} permissaoCenariosFiscais={permissaoCenariosFiscais} />
        </div>

        <div style={{ display: activeTab === 'envio' ? 'block' : 'none' }}>
          <EnvioPedidos vendedor={vendedorEfetivo} onEditPedido={handleEditPedido} />
        </div>
      </div>
    </div>
  );
}