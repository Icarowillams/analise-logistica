import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import SeletorPedidoOmie from './SeletorPedidoOmie';

export default function DevolucaoTab() {
  const [pedido, setPedido] = useState(null);
  const [produtos, setProdutos] = useState({});
  const [motivoGeral, setMotivoGeral] = useState('');
  const [tipoRetorno, setTipoRetorno] = useState('devolucao_parcial');
  const [salvando, setSalvando] = useState(false);

  const onPedidoCarregado = (p) => {
    setPedido(p);
    const obj = {};
    (p.det || []).forEach(item => {
      const cod = item.produto?.codigo_produto;
      obj[cod] = { quantidade: 0, motivo: '' };
    });
    setProdutos(obj);
  };

  const devolver = async () => {
    if (!pedido) return;
    const devolveArr = Object.entries(produtos)
      .filter(([_, v]) => Number(v.quantidade) > 0)
      .map(([cod, v]) => {
        const item = pedido.det.find(i => String(i.produto?.codigo_produto) === String(cod));
        return {
          nCodProd: cod,
          codigo_produto: cod,
          descricao: item?.produto?.descricao || '',
          quantidade: Number(v.quantidade),
          valor_unitario: item?.produto?.valor_unitario || 0,
          motivo: v.motivo
        };
      });

    if (devolveArr.length === 0) {
      toast.warning('Informe quantidade a devolver em ao menos 1 item');
      return;
    }

    setSalvando(true);
    try {
      const { data } = await base44.functions.invoke('devolverPedidoOmie', {
        codigo_pedido: pedido.cabecalho?.codigo_pedido,
        produtos: devolveArr,
        tipo_retorno: tipoRetorno,
        motivo_geral: motivoGeral
      });
      if (data?.sucesso) {
        toast.success(`Devolução registrada: R$ ${Number(data.valor_total).toFixed(2)}`);
        setPedido(null);
      } else {
        toast.error(data?.error || 'Erro ao devolver');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setSalvando(false);
  };

  return (
    <div className="space-y-4">
      {!pedido && <SeletorPedidoOmie onPedidoCarregado={onPedidoCarregado} etapas={['60']} />}

      {pedido && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Undo2 className="w-5 h-5 text-orange-500" />
              Devolver do pedido {pedido.cabecalho?.numero_pedido}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2 text-left">Produto</th>
                  <th className="p-2 text-right w-24">Faturado</th>
                  <th className="p-2 text-right w-28">A devolver</th>
                  <th className="p-2 text-left">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {(pedido.det || []).map(item => {
                  const cod = item.produto?.codigo_produto;
                  return (
                    <tr key={cod} className="border-t">
                      <td className="p-2">{item.produto?.descricao}</td>
                      <td className="p-2 text-right">{item.produto?.quantidade}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min="0"
                          max={item.produto?.quantidade}
                          value={produtos[cod]?.quantidade ?? 0}
                          onChange={(e) => setProdutos({ ...produtos, [cod]: { ...produtos[cod], quantidade: e.target.value } })}
                          className="h-8 text-right"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={produtos[cod]?.motivo || ''}
                          onChange={(e) => setProdutos({ ...produtos, [cod]: { ...produtos[cod], motivo: e.target.value } })}
                          className="h-8"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Tipo de retorno</Label>
                <Select value={tipoRetorno} onValueChange={setTipoRetorno}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="devolucao_parcial">Devolução parcial</SelectItem>
                    <SelectItem value="devolucao_total">Devolução total</SelectItem>
                    <SelectItem value="troca">Troca</SelectItem>
                    <SelectItem value="recusa_cliente">Recusa do cliente</SelectItem>
                    <SelectItem value="avaria">Avaria</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Motivo geral</Label>
                <Textarea value={motivoGeral} onChange={(e) => setMotivoGeral(e.target.value)} rows={1} />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setPedido(null)}>Cancelar</Button>
              <Button onClick={devolver} disabled={salvando}>
                {salvando && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Confirmar devolução
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}