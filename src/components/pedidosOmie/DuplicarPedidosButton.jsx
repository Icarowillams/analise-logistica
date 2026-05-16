import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import DuplicarPedidosModal from './DuplicarPedidosModal';

/**
 * Botão de duplicação em lote de pedidos Omie.
 * P5 (16/05): agora abre modal que pede cenário fiscal + plano de pagamento
 * antes de duplicar — itens/cliente/valores do original são reaproveitados.
 */
export default function DuplicarPedidosButton({ pedidosSelecionados, onSucesso }) {
  const [modalOpen, setModalOpen] = useState(false);

  if (pedidosSelecionados.length === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        className="border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800"
        onClick={() => {
          if (!pedidosSelecionados.length) {
            toast.error('Selecione ao menos um pedido.');
            return;
          }
          setModalOpen(true);
        }}
      >
        <Copy className="w-4 h-4 mr-2" />
        Duplicar {pedidosSelecionados.length} pedido{pedidosSelecionados.length > 1 ? 's' : ''}
      </Button>

      <DuplicarPedidosModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        pedidosSelecionados={pedidosSelecionados}
        onSucesso={onSucesso}
      />
    </>
  );
}