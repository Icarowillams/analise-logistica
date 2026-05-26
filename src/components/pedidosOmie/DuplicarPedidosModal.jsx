import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Copy, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function DuplicarPedidosModal({ open, onOpenChange, pedidosSelecionados, onSucesso }) {
  const [duplicando, setDuplicando] = useState(false);

  const handleDuplicar = async () => {
    setDuplicando(true);
    try {
      const payload = {
        pedidos: pedidosSelecionados.map(p => ({
          codigo_pedido: p.codigo_pedido,
          codigo_pedido_integracao: p.codigo_pedido_integracao
        }))
      };
      const { data } = await base44.functions.invoke('duplicarPedidoOmie', payload);
      if (data?.error || data?.erro) {
        toast.error(data.error || data.erro);
      } else {
        const ok = data?.sucessos || 0;
        const fail = data?.erros || 0;
        if (ok > 0) toast.success(`${ok} pedido(s) duplicado(s) e enviado(s) para a tela de Envio.`);
        if (fail > 0) {
          const primeirosErros = (data?.resultados || []).filter(r => !r.sucesso).slice(0, 3).map(r => r.erro).join(' | ');
          toast.error(`${fail} falha(s): ${primeirosErros}`);
        }
        onSucesso?.();
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(e.message || 'Erro ao duplicar pedidos');
    } finally {
      setDuplicando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-5 h-5 text-amber-500" />
            Duplicar {pedidosSelecionados.length} pedido{pedidosSelecionados.length > 1 ? 's' : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            O pedido será copiado novamente para a tela de Envio como <b>pendente</b>, mantendo cliente,
            cenário, forma de pagamento, data, observações, itens, quantidades e valores do original.
          </div>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={duplicando}>
            Cancelar
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700"
            onClick={handleDuplicar}
            disabled={duplicando}
          >
            {duplicando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Copy className="w-4 h-4 mr-1" />}
            Duplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}