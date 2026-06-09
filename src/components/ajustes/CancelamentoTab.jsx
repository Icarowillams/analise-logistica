import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ban, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
          etapa: pedido.cabecalho?.etapa || '',
          data_faturamento: pedido.informacoes_adicionais?.dFat || pedido.cabecalho?.data_previsao || ''
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
              {pedido.informacoes_adicionais?.numero_nfe && (
                <div><span className="text-slate-500">NF-e:</span> {pedido.informacoes_adicionais.numero_nfe}</div>
              )}
            </div>
            {(() => {
              const dFat = pedido.informacoes_adicionais?.dFat || pedido.cabecalho?.data_previsao;
              if (!dFat || !pedido.informacoes_adicionais?.numero_nfe) return null;
              const horas = (Date.now() - new Date(dFat).getTime()) / (1000 * 60 * 60);
              if (horas > 24) {
                return (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Prazo expirado!</strong> A NF-e foi emitida há {Math.floor(horas)}h. 
                      O cancelamento só é permitido em até 24 horas. Após esse prazo, é necessário emitir uma NF-e de devolução/estorno.
                    </AlertDescription>
                  </Alert>
                );
              }
              if (horas > 20) {
                return (
                  <Alert className="border-amber-300 bg-amber-50">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800">
                      <strong>Atenção:</strong> Restam apenas {Math.floor(24 - horas)}h para cancelar esta NF-e. O prazo máximo é de 24 horas.
                    </AlertDescription>
                  </Alert>
                );
              }
              return null;
            })()}
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
              <Button variant="destructive" onClick={cancelar} disabled={loading || !motivo || (() => {
                const dFat = pedido?.informacoes_adicionais?.dFat || pedido?.cabecalho?.data_previsao;
                if (!dFat || !pedido?.informacoes_adicionais?.numero_nfe) return false;
                return (Date.now() - new Date(dFat).getTime()) / (1000 * 60 * 60) > 24;
              })()}>
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