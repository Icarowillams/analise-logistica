import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import SeletorPedidoOmie from './SeletorPedidoOmie';

export default function CorteTab() {
  const [pedido, setPedido] = useState(null);
  const [cortes, setCortes] = useState({});
  const [motivoGeral, setMotivoGeral] = useState('');
  const [salvando, setSalvando] = useState(false);

  const onPedidoCarregado = (p) => {
    setPedido(p);
    const obj = {};
    (p.det || []).forEach(item => {
      const cod = item.produto?.codigo_produto;
      obj[cod] = { nova_quantidade: item.produto?.quantidade || 0, motivo: '' };
    });
    setCortes(obj);
  };

  const aplicarCorte = async () => {
    if (!pedido) return;
    const cortesArr = Object.entries(cortes)
      .filter(([cod, v]) => {
        const original = pedido.det.find(i => String(i.produto?.codigo_produto) === String(cod));
        return original && Number(v.nova_quantidade) !== Number(original.produto?.quantidade);
      })
      .map(([cod, v]) => ({ codigo_produto: cod, nova_quantidade: Number(v.nova_quantidade), motivo: v.motivo }));

    if (cortesArr.length === 0) {
      toast.warning('Nenhuma alteração a aplicar');
      return;
    }

    setSalvando(true);
    try {
      const { data } = await base44.functions.invoke('cortarPedidoOmie', {
        codigo_pedido: pedido.cabecalho?.codigo_pedido,
        cortes: cortesArr,
        motivo_geral: motivoGeral
      });
      if (data?.sucesso) {
        toast.success(`${data.itens_alterados} itens alterados`);
        setPedido(null);
      } else {
        toast.error(data?.error || 'Erro ao cortar');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setSalvando(false);
  };

  return (
    <div className="space-y-4">
      {!pedido && <SeletorPedidoOmie onPedidoCarregado={onPedidoCarregado} etapas={['10', '20', '50']} />}

      {pedido && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Scissors className="w-5 h-5 text-amber-500" />
              Pedido {pedido.cabecalho?.numero_pedido} — Etapa {pedido.cabecalho?.etapa}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2 text-left">Produto</th>
                  <th className="p-2 text-right w-24">Qtd atual</th>
                  <th className="p-2 text-right w-28">Nova qtd</th>
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
                          value={cortes[cod]?.nova_quantidade ?? ''}
                          onChange={(e) => setCortes({ ...cortes, [cod]: { ...cortes[cod], nova_quantidade: e.target.value } })}
                          className="h-8 text-right"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={cortes[cod]?.motivo || ''}
                          onChange={(e) => setCortes({ ...cortes, [cod]: { ...cortes[cod], motivo: e.target.value } })}
                          className="h-8"
                          placeholder="Motivo específico"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-4 space-y-2">
              <Textarea
                placeholder="Motivo geral (aplica-se a todos sem motivo específico)"
                value={motivoGeral}
                onChange={(e) => setMotivoGeral(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPedido(null)}>Cancelar</Button>
                <Button onClick={aplicarCorte} disabled={salvando}>
                  {salvando && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Aplicar corte
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}