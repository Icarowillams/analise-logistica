import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function BuscarPedidoOmie({ onPedidoCarregado }) {
  const [codigoPedido, setCodigoPedido] = useState('');
  const [loading, setLoading] = useState(false);

  const buscar = async () => {
    if (!codigoPedido) return;
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('consultarPedidoOmie', {
        codigo_pedido: codigoPedido
      });
      if (data?.sucesso && data?.pedido) {
        onPedidoCarregado(data.pedido);
      } else {
        toast.error(data?.error || 'Pedido não encontrado');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label>Código do pedido Omie (nCodPed)</Label>
            <Input value={codigoPedido} onChange={(e) => setCodigoPedido(e.target.value)} placeholder="Ex: 11499800490" />
          </div>
          <Button onClick={buscar} disabled={loading || !codigoPedido}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
            Buscar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}