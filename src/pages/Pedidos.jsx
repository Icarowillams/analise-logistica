import React from 'react';
import { ShoppingCart } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Info } from 'lucide-react';
import PedidosOmieConsulta from '@/components/pedidosOmie/PedidosOmieConsulta';

export default function Pedidos() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Pedidos"
        subtitle="Consulta unificada de pedidos de venda e pedidos de troca efetuados no Omie"
        icon={ShoppingCart}
      />

      <Card className="border-0 shadow-sm bg-blue-50/50">
        <CardContent className="p-3 flex items-start gap-2 text-sm">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <p className="text-blue-900">
            <strong>Pedidos vindos do Omie.</strong> Vendas e trocas continuam separados em seus cadastros, mas agora aparecem juntos nesta consulta.
          </p>
        </CardContent>
      </Card>

      <PedidosOmieConsulta />
    </div>
  );
}