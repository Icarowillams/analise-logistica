import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ShoppingCart } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DigitarPedido from '@/components/Pedidos/DigitarPedido';
import EnvioPedidos from '@/components/Pedidos/EnvioPedidos';

export default function Pedidos() {
  const [currentUser, setCurrentUser] = useState(null);
  const [vendedorAtual, setVendedorAtual] = useState(null);
  const [activeTab, setActiveTab] = useState('digitar');
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
    }).catch(() => {});
  }, [vendedores]);

  const handleEditPedido = (pedidoId) => {
    setEditingPedidoId(pedidoId);
    setActiveTab('digitar');
  };

  if (!vendedorAtual) {
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
      <PageHeader title="Pedidos" subtitle={`Vendedor: ${vendedorAtual.nome}`} icon={ShoppingCart} />
      
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v !== 'digitar') setEditingPedidoId(null); }}>
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="digitar">Digitar Pedidos</TabsTrigger>
          <TabsTrigger value="envio">Envio de Pedidos</TabsTrigger>
        </TabsList>

        <TabsContent value="digitar">
          <DigitarPedido vendedor={vendedorAtual} editingPedidoId={editingPedidoId} onClearEdit={() => setEditingPedidoId(null)} />
        </TabsContent>

        <TabsContent value="envio">
          <EnvioPedidos vendedor={vendedorAtual} onEditPedido={handleEditPedido} />
        </TabsContent>
      </Tabs>
    </div>
  );
}