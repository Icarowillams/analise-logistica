import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ShoppingCart } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DigitarPedido from '@/components/Pedidos/DigitarPedido';
import EnvioPedidos from '@/components/Pedidos/EnvioPedidos';
import GerenciarPedidos from '@/components/Pedidos/GerenciarPedidos';

export default function Pedidos() {
  const [currentUser, setCurrentUser] = useState(null);
  const [vendedorAtual, setVendedorAtual] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [editingPedidoId, setEditingPedidoId] = useState(null);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  useEffect(() => {
    base44.auth.me().then(user => {
      setCurrentUser(user);
      const vendedor = vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
      setVendedorAtual(vendedor);
      if (!activeTab) {
        setActiveTab(vendedor ? 'digitar' : 'gerenciar');
      }
    }).catch(() => {});
  }, [vendedores]);

  const handleEditPedido = (pedidoId) => {
    setEditingPedidoId(pedidoId);
    setActiveTab('digitar');
  };

  const isAdmin = currentUser?.role === 'admin';

  if (!vendedorAtual && !isAdmin) {
    return (
      <div>
        <PageHeader title="Pedidos" icon={ShoppingCart} />
        <Alert>
          <AlertDescription>
            Você não está cadastrado como funcionário no sistema. Entre em contato com o administrador.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Pedidos" subtitle={vendedorAtual ? `Vendedor: ${vendedorAtual.nome}` : 'Gestão de Pedidos'} icon={ShoppingCart} />
      
      <Tabs value={activeTab || 'gerenciar'} onValueChange={(v) => { setActiveTab(v); if (v !== 'digitar') setEditingPedidoId(null); }}>
        <TabsList className={`grid w-full mb-6 ${vendedorAtual ? 'grid-cols-3' : 'grid-cols-1'}`}>
          {vendedorAtual && <TabsTrigger value="digitar">Digitar Pedidos</TabsTrigger>}
          {vendedorAtual && <TabsTrigger value="envio">Envio de Pedidos</TabsTrigger>}
          <TabsTrigger value="gerenciar">Gerenciar Pedidos</TabsTrigger>
        </TabsList>

        {vendedorAtual && (
          <TabsContent value="digitar">
            <DigitarPedido vendedor={vendedorAtual} editingPedidoId={editingPedidoId} onClearEdit={() => setEditingPedidoId(null)} />
          </TabsContent>
        )}

        {vendedorAtual && (
          <TabsContent value="envio">
            <EnvioPedidos vendedor={vendedorAtual} onEditPedido={handleEditPedido} />
          </TabsContent>
        )}

        <TabsContent value="gerenciar">
          <GerenciarPedidos onEditPedido={handleEditPedido} />
        </TabsContent>
      </Tabs>
    </div>
  );
}