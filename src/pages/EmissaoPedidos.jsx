import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ShoppingCart } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DigitarPedido from '@/components/Pedidos/DigitarPedido';
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

  const permissaoCenariosFiscais = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    if (!vendedorAtual) return false;
    const perm = permissoes.find(p => p.vendedor_id === vendedorAtual.id);
    return perm?.permissoes_pedidos?.usar_cenarios_fiscais || false;
  }, [currentUser, vendedorAtual, permissoes]);

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

  if (!vendedorAtual && isAdmin) {
    return (
      <div>
        <PageHeader title="Emissão de Pedidos" subtitle="Gestão de Pedidos" icon={ShoppingCart} />
        <Alert>
          <AlertDescription>
            Você é administrador mas não possui um vendedor vinculado. A emissão de pedidos requer um vendedor associado.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Emissão de Pedidos" subtitle={`Vendedor: ${vendedorAtual.nome}`} icon={ShoppingCart} />
      
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v !== 'digitar') setEditingPedidoId(null); }}>
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="digitar">Digitar Pedidos</TabsTrigger>
          <TabsTrigger value="envio">Envio de Pedidos</TabsTrigger>
        </TabsList>

        <TabsContent value="digitar">
          <DigitarPedido vendedor={vendedorAtual} editingPedidoId={editingPedidoId} onClearEdit={() => setEditingPedidoId(null)} permissaoCenariosFiscais={permissaoCenariosFiscais} />
        </TabsContent>

        <TabsContent value="envio">
          <EnvioPedidos vendedor={vendedorAtual} onEditPedido={handleEditPedido} />
        </TabsContent>
      </Tabs>
    </div>
  );
}