import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

const MOTIVOS = [
  'Não fez pedido', 'Duplicidade', 'Valores divergentes', 'Desacordo comercial',
  'Cliente ausente', 'Endereço incorreto', 'Fora do horário', 'Sem conferente', 'Outro'
];

export default function MotivoNaoEntregueModal({ open, onOpenChange, onConfirm, loading }) {
  const [motivo, setMotivo] = useState('');
  const [obs, setObs] = useState('');

  const confirmar = () => {
    if (!motivo) return;
    onConfirm({ motivo: obs ? `${motivo} — ${obs}` : motivo });
    setMotivo(''); setObs('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como Não Entregue</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Motivo</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
              <SelectContent>
                {MOTIVOS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Observação (opcional)</Label>
            <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
          <p className="text-xs text-amber-600">
            Esta ação cancelará o pedido/NF no Omie e atualizará o pedido local como cancelado.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!motivo || loading} className="bg-red-600 hover:bg-red-700">
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Confirmar Não Entrega
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}