import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight, AlertTriangle } from 'lucide-react';

export default function ConfirmarAcaoModal({ open, onOpenChange, acao, onConfirmar, loading }) {
  if (!acao) return null;

  const { titulo, descricao, de, para, pedido, badgeColor = 'amber', perigo = false } = acao;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {perigo && <AlertTriangle className="w-5 h-5 text-red-500" />}
            {titulo}
          </DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>

        {pedido && (
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">Pedido</span>
              <span className="text-sm font-semibold">Nº {pedido.numero_pedido}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">Cliente</span>
              <span className="text-sm font-medium text-right max-w-[200px] truncate">{pedido.cliente_nome || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">Valor</span>
              <span className="text-sm font-semibold">
                R$ {Number(pedido.valor_total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}

        {de && para && (
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="flex-1 text-center">
              <div className="text-xs text-slate-500 mb-1">De</div>
              <div className="bg-slate-100 text-slate-700 rounded-md py-2 px-3 text-sm font-medium">{de}</div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400" />
            <div className="flex-1 text-center">
              <div className="text-xs text-slate-500 mb-1">Para</div>
              <div className={`bg-${badgeColor}-100 text-${badgeColor}-800 rounded-md py-2 px-3 text-sm font-semibold border border-${badgeColor}-200`}>
                {para}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={onConfirmar}
            disabled={loading}
            className={perigo ? 'bg-red-600 hover:bg-red-700' : `bg-${badgeColor}-500 hover:bg-${badgeColor}-600`}
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}