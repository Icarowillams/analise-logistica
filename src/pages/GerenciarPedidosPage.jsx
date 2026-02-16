import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ClipboardList } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import GerenciarPedidos from '@/components/Pedidos/GerenciarPedidos';
import DigitarPedido from '@/components/Pedidos/DigitarPedido';

export default function GerenciarPedidosPage() {
  const [currentUser, setCurrentUser] = useState(null);
  const [editingPedidoId, setEditingPedidoId] = useState(null);
  const [vendedorParaEditar, setVendedorParaEditar] = useState(null);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const isAdmin = currentUser?.role === 'admin';
  const vendedorAtual = vendedores.find(v => v.email?.toLowerCase() === currentUser?.email?.toLowerCase());

  const handleEditPedido = async (pedidoId) => {
    setEditingPedidoId(pedidoId);
    // Buscar o vendedor do pedido para poder abrir o formulário
    const allPedidos = await base44.entities.Pedido.list('-created_date', 5000);
    const pedido = allPedidos.find(p => p.id === pedidoId);
    if (pedido) {
      const vend = vendedores.find(v => v.id === pedido.vendedor_id);
      if (vend) setVendedorParaEditar(vend);
      else if (vendedorAtual) setVendedorParaEditar(vendedorAtual);
    }
  };

  if (!currentUser) {
    return (
      <div>
        <PageHeader title="Gerenciar Pedidos" icon={ClipboardList} />
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
        </div>
      </div>
    );
  }

  // Se está editando um pedido, mostra o formulário
  if (editingPedidoId && vendedorParaEditar) {
    return (
      <div>
        <PageHeader title="Gerenciar Pedidos" subtitle="Editando pedido" icon={ClipboardList} />
        <DigitarPedido
          vendedor={vendedorParaEditar}
          editingPedidoId={editingPedidoId}
          onClearEdit={() => {
            setEditingPedidoId(null);
            setVendedorParaEditar(null);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Gerenciar Pedidos" subtitle="Gestão de todos os pedidos" icon={ClipboardList} />
      <GerenciarPedidos onEditPedido={handleEditPedido} />
    </div>
  );
}