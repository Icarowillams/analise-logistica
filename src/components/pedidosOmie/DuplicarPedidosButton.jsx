import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * Botão de duplicação em lote de pedidos Omie.
 * Recebe uma lista de pedidos selecionados (com codigo_pedido) e dispara a função
 * backend duplicarPedidoOmie que cria pedidos novos no Omie com os mesmos itens.
 */
export default function DuplicarPedidosButton({ pedidosSelecionados, onSucesso }) {
  const [duplicando, setDuplicando] = useState(false);

  const handleDuplicar = async () => {
    if (!pedidosSelecionados.length) {
      toast.error('Selecione ao menos um pedido.');
      return;
    }
    setDuplicando(true);
    try {
      const payload = {
        pedidos: pedidosSelecionados.map(p => ({
          codigo_pedido: p.codigo_pedido,
          codigo_pedido_integracao: p.codigo_pedido_integracao
        }))
      };
      const { data } = await base44.functions.invoke('duplicarPedidoOmie', payload);
      if (data?.error) {
        toast.error(data.error);
      } else {
        const ok = data?.sucessos || 0;
        const fail = data?.erros || 0;
        if (ok > 0) toast.success(`${ok} pedido(s) duplicado(s) com sucesso.`);
        if (fail > 0) {
          const primeirosErros = (data?.resultados || []).filter(r => !r.sucesso).slice(0, 3).map(r => r.erro).join(' | ');
          toast.error(`${fail} falha(s): ${primeirosErros}`);
        }
        onSucesso?.();
      }
    } catch (e) {
      toast.error(e.message || 'Erro ao duplicar pedidos');
    } finally {
      setDuplicando(false);
    }
  };

  if (pedidosSelecionados.length === 0) return null;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800">
          <Copy className="w-4 h-4 mr-2" />
          Duplicar {pedidosSelecionados.length} pedido{pedidosSelecionados.length > 1 ? 's' : ''}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Duplicar pedidos selecionados?</AlertDialogTitle>
          <AlertDialogDescription>
            Serão criados <strong>{pedidosSelecionados.length}</strong> novo(s) pedido(s) no Omie com os mesmos produtos, valores, cliente e cenário fiscal do original. Os novos pedidos entrarão como <strong>Etapa 10 (Pedido)</strong> com data de previsão de hoje. Esta ação não pode ser desfeita pelo sistema.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={duplicando}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleDuplicar} disabled={duplicando} className="bg-amber-600 hover:bg-amber-700">
            {duplicando ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Duplicando...</> : 'Duplicar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}