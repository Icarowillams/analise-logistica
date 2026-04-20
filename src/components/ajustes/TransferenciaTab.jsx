import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function TransferenciaTab() {
  const [codigoPedido, setCodigoPedido] = useState('');
  const [cargaOrigemId, setCargaOrigemId] = useState('');
  const [cargaDestinoId, setCargaDestinoId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  const { data: cargas = [] } = useQuery({
    queryKey: ['cargas', 'ativas'],
    queryFn: () => base44.entities.Carga.filter({ status_carga: { $in: ['montando', 'conferindo', 'pronta'] } }, '-data_carga', 200)
  });

  const transferir = async () => {
    if (!codigoPedido || !cargaOrigemId || !cargaDestinoId) {
      toast.error('Preencha todos os campos');
      return;
    }
    if (cargaOrigemId === cargaDestinoId) {
      toast.error('Carga origem e destino devem ser diferentes');
      return;
    }

    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('transferirPedidoCarga', {
        pedido_codigo_omie: codigoPedido,
        carga_origem_id: cargaOrigemId,
        carga_destino_id: cargaDestinoId,
        motivo
      });
      if (data?.sucesso) {
        toast.success('Transferência realizada');
        setCodigoPedido('');
        setMotivo('');
      } else {
        toast.error(data?.error || 'Erro ao transferir');
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
          <ArrowLeftRight className="w-5 h-5 text-indigo-500" />
          Transferir Pedido entre Cargas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Código do pedido Omie</Label>
          <Input value={codigoPedido} onChange={(e) => setCodigoPedido(e.target.value)} placeholder="nCodPed" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Carga origem</Label>
            <Select value={cargaOrigemId} onValueChange={setCargaOrigemId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {cargas.map(c => <SelectItem key={c.id} value={c.id}>{c.numero_carga} — {c.data_carga}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Carga destino</Label>
            <Select value={cargaDestinoId} onValueChange={setCargaDestinoId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {cargas.map(c => <SelectItem key={c.id} value={c.id}>{c.numero_carga} — {c.data_carga}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Motivo</Label>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
        </div>
        <div className="flex justify-end">
          <Button onClick={transferir} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Transferir
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}