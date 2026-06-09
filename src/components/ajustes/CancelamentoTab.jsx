import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ban, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import SeletorPedidoOmie from './SeletorPedidoOmie';

export default function CancelamentoTab() {
  const [pedido, setPedido] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [origem, setOrigem] = useState('manual');
  const [loading, setLoading] = useState(false);

  const cancelar = async () => {
    if (!pedido || !motivo) {
      toast.error('Selecione um pedido e informe o motivo');
      return;
    }
    const codigoPedido = pedido.cabecalho?.codigo_pedido;
    if (!confirm(`Cancelar pedido ${pedido.cabecalho?.numero_pedido}? Esta ação é IRREVERSÍVEL no Omie.`)) return;

    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('cancelarNfOmie', {
        codigo_pedido: codigoPedido,
        motivo,
        origem,
        dados_pedido: {
          numero_nfe: pedido.informacoes_adicionais?.numero_nfe || '',
          valor_total: pedido.total_pedido?.valor_total_pedido || 0,
          cliente_nome: pedido.cabecalho?.cliente_nome || '',
          etapa: pedido.cabecalho?.etapa || ''
        }
      });
      if (data?.sucesso) {
        toast.success(`Pedido ${data.status === 'ja_cancelado' ? 'já estava cancelado' : 'cancelado com sucesso'}`);
        setPedido(null);
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
    <div className="space-y-4">
      {!pedido && <SeletorPedidoOmie onPedidoCarregado={setPedido} etapas={['10', '20', '50', '60']} />}

      {pedido && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Ban className="w-5 h-5 text-red-500" />
              Cancelar Pedido {pedido.cabecalho?.numero_pedido} — Etapa {pedido.cabecalho?.etapa}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-slate-50 rounded p-3 text-sm">
              <div><span className="text-slate-500">Cliente:</span> {pedido.cabecalho?.cliente_nome || '-'}</div>
              <div><span className="text-slate-500">Valor:</span> R$ {Number(pedido.total_pedido?.valor_total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
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
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setPedido(null); setMotivo(''); }}>Voltar</Button>
              <Button variant="destructive" onClick={cancelar} disabled={loading || !motivo}>
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Cancelar pedido
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}