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
import { Input } from '@/components/ui/input';
import { Loader2, XCircle, AlertTriangle, ShieldAlert } from 'lucide-react';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

export default function CancelarPedidoModal({ open, onOpenChange, pedido, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  const pedidos = Array.isArray(pedido) ? pedido : [pedido].filter(Boolean);
  const primeiroPedido = pedidos[0];
  const isMultiplo = pedidos.length > 1;
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  // Confirmação reforçada para múltiplos: usuário precisa DIGITAR a quantidade exata
  const [confirmacaoQtd, setConfirmacaoQtd] = useState('');
  // Estado de bloqueio anti-massa retornado pelo backend (429)
  const [bloqueadoMassa, setBloqueadoMassa] = useState(false);

  const qtdConfirmada = !isMultiplo || confirmacaoQtd.trim() === String(pedidos.length);

  const resetar = () => {
    setMotivo('');
    setErro('');
    setConfirmacaoQtd('');
    setBloqueadoMassa(false);
  };

  // forcarMassa: quando true, reenvia já autorizando o cancelamento em massa (confirmar_massa)
  const executar = async (forcarMassa) => {
    if (!motivo.trim()) return;
    setLoading(true);
    setErro('');
    try {
      await onConfirm(pedido, motivo.trim(), { confirmarMassa: forcarMassa });
      resetar();
      onOpenChange(false);
    } catch (e) {
      // Backend pausou por proteção anti-massa (HTTP 429)
      if (e?.bloqueado_massa) {
        setBloqueadoMassa(true);
        setErro(e?.message || 'Cancelamento pausado pela proteção de segurança.');
      } else {
        setErro(e?.message || 'Erro ao cancelar pedido');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (isOpen) => {
    if (!isOpen) resetar();
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="w-5 h-5" />
            {isMultiplo ? 'Cancelar Pedidos' : 'Cancelar Pedido'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold">
              {isMultiplo
                ? `${pedidos.length} pedidos selecionados para cancelamento`
                : `Pedido ${primeiroPedido?.numero_pedido ? `#${formatarNumeroPedido(primeiroPedido)}` : ''} — ${primeiroPedido?.cliente_nome || ''}`}
            </p>
            {!isMultiplo && (
              <p className="text-xs mt-1">
                Valor: R$ {(primeiroPedido?.valor_total || 0).toFixed(2)} | Vendedor: {primeiroPedido?.vendedor_nome}
              </p>
            )}
            {pedidos.some(p => p?.omie_enviado) && (
              <p className="text-xs mt-1 font-medium">
                ⚠ Os pedidos enviados serão verificados e cancelados no Omie. Só é possível cancelar pedidos nas etapas "Pedido de Venda" ou "Pedidos Liberados".
              </p>
            )}
          </div>

          {/* 🛡️ Confirmação reforçada para cancelamento em massa */}
          {isMultiplo && !bloqueadoMassa && (
            <div className="bg-orange-50 border-2 border-orange-300 rounded-lg p-3 space-y-2">
              <p className="text-sm font-bold text-orange-800 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                Você vai cancelar {pedidos.length} pedidos
              </p>
              <p className="text-xs text-orange-700">
                Isso <strong>EXCLUI no Omie</strong> e <strong>não desfaz</strong>. Para liberar, digite <strong>{pedidos.length}</strong> no campo abaixo.
              </p>
              <Input
                inputMode="numeric"
                placeholder={`Digite ${pedidos.length} para confirmar`}
                value={confirmacaoQtd}
                onChange={(e) => setConfirmacaoQtd(e.target.value)}
                className="border-orange-300 focus-visible:ring-orange-400"
              />
            </div>
          )}

          {erro && (
            <div className={`border rounded-lg p-3 text-sm flex items-start gap-2 ${bloqueadoMassa ? 'bg-red-50 border-red-300 text-red-800' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
              {bloqueadoMassa ? <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
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
          {bloqueadoMassa ? (
            // Backend pausou: usuário decide explicitamente liberar o cancelamento em massa
            <Button
              onClick={() => executar(true)}
              disabled={!motivo.trim() || loading}
              className="bg-red-700 hover:bg-red-800 text-white"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Cancelando...</>
              ) : (
                <><ShieldAlert className="w-4 h-4 mr-2" /> Confirmar cancelamento em massa</>
              )}
            </Button>
          ) : (
            <Button
              onClick={() => executar(false)}
              disabled={!motivo.trim() || !qtdConfirmada || loading}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verificando e cancelando...</>
              ) : (
                <><XCircle className="w-4 h-4 mr-2" /> Confirmar Cancelamento{isMultiplo ? ` (${pedidos.length})` : ''}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}