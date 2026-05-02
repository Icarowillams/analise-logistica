import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import SeletorPedidoOmie from './SeletorPedidoOmie';

export default function TransferenciaTab() {
  const [pedido, setPedido] = useState(null);
  const [cargaOrigemId, setCargaOrigemId] = useState('');
  const [cargaDestinoId, setCargaDestinoId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  const { data: cargas = [] } = useQuery({
    queryKey: ['cargas', 'ativas'],
    queryFn: () => base44.entities.Carga.filter({ status_carga: { $in: ['montando', 'montagem', 'conferindo', 'pronta', 'fechada'] } }, '-data_carga', 200)
  });

  const transferir = async () => {
    if (!pedido || !cargaOrigemId || !cargaDestinoId) {
      toast.error('Selecione o pedido e as cargas origem/destino');
      return;
    }
    if (cargaOrigemId === cargaDestinoId) {
      toast.error('Carga origem e destino devem ser diferentes');
      return;
    }

    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('transferirPedidoCarga', {
        pedido_codigo_omie: pedido.cabecalho?.codigo_pedido,
        carga_origem_id: cargaOrigemId,
        carga_destino_id: cargaDestinoId,
        motivo
      });
      if (data?.sucesso) {
        toast.success('Transferência realizada');
        setPedido(null);
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
    <div className="space-y-4">
      {!pedido && <SeletorPedidoOmie onPedidoCarregado={setPedido} etapas={['50', '60']} />}

      {pedido && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-indigo-500" />
              Transferir pedido {pedido.cabecalho?.numero_pedido} entre cargas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-slate-50 rounded p-3 text-sm">
              <div><span className="text-slate-500">Cliente:</span> {pedido.cabecalho?.cliente_nome || '-'}</div>
              <div><span className="text-slate-500">Valor:</span> R$ {Number(pedido.total_pedido?.valor_total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
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
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPedido(null)}>Voltar</Button>
              <Button onClick={transferir} disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Transferir
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}