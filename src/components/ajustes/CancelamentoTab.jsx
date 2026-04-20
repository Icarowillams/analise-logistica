import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ban, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function CancelamentoTab() {
  const [codigoPedido, setCodigoPedido] = useState('');
  const [motivo, setMotivo] = useState('');
  const [origem, setOrigem] = useState('manual');
  const [loading, setLoading] = useState(false);

  const cancelar = async () => {
    if (!codigoPedido || !motivo) {
      toast.error('Código e motivo obrigatórios');
      return;
    }
    if (!confirm(`Cancelar pedido ${codigoPedido}? Esta ação é IRREVERSÍVEL no Omie.`)) return;

    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('cancelarNfOmie', {
        codigo_pedido: codigoPedido,
        motivo,
        origem
      });
      if (data?.sucesso) {
        toast.success(`Pedido ${data.status === 'ja_cancelado' ? 'já estava cancelado' : 'cancelado com sucesso'}`);
        setCodigoPedido('');
        setMotivo('');
      } else {
        toast.error(data?.erro || data?.error || 'Erro ao cancelar');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Ban className="w-5 h-5 text-red-500" />
          Cancelar Pedido/NF no Omie
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Código do pedido Omie</Label>
          <Input value={codigoPedido} onChange={(e) => setCodigoPedido(e.target.value)} placeholder="nCodPed" />
        </div>
        <div>
          <Label>Origem do cancelamento</Label>
          <Select value={origem} onValueChange={setOrigem}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="acerto_caixa">Acerto de caixa</SelectItem>
              <SelectItem value="rota_devolucao">Rota/devolução</SelectItem>
              <SelectItem value="outros">Outros</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Motivo <span className="text-red-500">*</span></Label>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
        </div>
        <div className="flex justify-end">
          <Button variant="destructive" onClick={cancelar} disabled={loading || !codigoPedido || !motivo}>
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Cancelar pedido
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}