import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, XCircle, AlertTriangle } from 'lucide-react';

export default function CancelarPedidoModal({ open, onOpenChange, pedido, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const handleConfirm = async () => {
    if (!motivo.trim()) return;
    setLoading(true);
    setErro('');
    try {
      await onConfirm(pedido, motivo.trim());
      setMotivo('');
      setErro('');
      onOpenChange(false);
    } catch (e) {
      setErro(e?.message || 'Erro ao cancelar pedido');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (isOpen) => {
    if (!isOpen) {
      setMotivo('');
      setErro('');
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="w-5 h-5" />
            Cancelar Pedido
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold">
              Pedido {pedido?.numero_pedido ? `#${pedido.numero_pedido}` : ''} — {pedido?.cliente_nome}
            </p>
            <p className="text-xs mt-1">
              Valor: R$ {(pedido?.valor_total || 0).toFixed(2)} | Vendedor: {pedido?.vendedor_nome}
            </p>
            {pedido?.omie_enviado && (
              <p className="text-xs mt-1 font-medium">
                ⚠ Este pedido será verificado e cancelado no Omie. Só é possível cancelar pedidos nas etapas "Pedido de Venda" ou "Pedidos Liberados".
              </p>
            )}
          </div>

          {erro && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{erro}</p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 block">
              Motivo do cancelamento <span className="text-red-500">*</span>
            </label>
            <Textarea
              placeholder="Descreva o motivo do cancelamento..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            Voltar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!motivo.trim() || loading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verificando e cancelando...</>
            ) : (
              <><XCircle className="w-4 h-4 mr-2" /> Confirmar Cancelamento</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}