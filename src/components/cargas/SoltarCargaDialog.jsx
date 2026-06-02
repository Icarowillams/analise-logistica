import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function SoltarCargaDialog({ open, onOpenChange, carga, onSolto }) {
  const [motivo, setMotivo] = useState('');
  const [soltando, setSoltando] = useState(false);

  const jaFaturada = carga?.status_carga === 'faturada';
  const totalPedidos = (carga?.pedidos_omie?.length || 0) + (carga?.pedidos_internos?.length || 0) + (carga?.pedidos_troca?.length || 0);

  const soltar = async () => {
    setSoltando(true);
    try {
      const { data } = await base44.functions.invoke('soltarCarga', {
        carga_id: carga.id,
        motivo: motivo || 'Não informado'
      });
      if (data?.error) throw new Error(data.error);
      toast.success(data?.mensagem || 'Carga solta com sucesso');
      setMotivo('');
      onSolto?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message);
    }
    setSoltando(false);
  };

  if (!carga) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Soltar Carga {carga.numero_carga}</DialogTitle>
          <DialogDescription>
            Os pedidos serão liberados e voltarão para a Montagem de Carga.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {jaFaturada && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                <strong>Atenção!</strong> Esta carga já foi faturada (enviada ao Omie).
                Os pedidos podem estar em etapa avançada no Omie. Verifique antes de prosseguir.
              </div>
            </div>
          )}

          <div className="bg-slate-50 border rounded-lg p-3 text-sm space-y-1">
            <p><strong>{totalPedidos}</strong> pedido(s) serão liberados</p>
            <p>Motorista: {carga.motorista_nome || '—'}</p>
            <p>Valor total: R$ {Number(carga.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>

          <div>
            <Label>Motivo</Label>
            <Textarea
              placeholder="Ex: Caminhão quebrou, produtos errados..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="destructive"
            onClick={soltar}
            disabled={soltando}
          >
            {soltando && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Soltar Carga
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}