import React, { useState } from 'react';
import { Truck, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import useDadosMontagem from '@/components/cargas/useDadosMontagem';
import StatsCardsMontagem from '@/components/cargas/StatsCardsMontagem';
import PedidosPorRota from '@/components/cargas/PedidosPorRota';
import ProdutosConsolidados from '@/components/cargas/ProdutosConsolidados';
import PainelFecharCarga from '@/components/cargas/PainelFecharCarga';

export default function MontagemCarga() {
  const { loading, pedidos, motoristas, veiculos, cargas, recarregar } = useDadosMontagem();
  const [selecionados, setSelecionados] = useState([]);

  const pedidosSelecionados = pedidos.filter(p => selecionados.includes(p.codigo_pedido));

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Truck className="w-8 h-8 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold">Montagem de Carga</h1>
            <p className="text-sm text-slate-500">Pedidos Omie na etapa 20 (Aprovação) + Pedidos de Troca aprovados</p>
          </div>
        </div>
        <Button variant="outline" onClick={recarregar} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <StatsCardsMontagem pedidos={pedidos} selecionados={selecionados} />

      {loading ? (
        <div className="py-12 text-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin inline" />
          <div className="mt-2">Carregando pedidos Omie + trocas...</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <PedidosPorRota pedidos={pedidos} selecionados={selecionados} setSelecionados={setSelecionados} />
          </div>
          <div className="space-y-4">
            <PainelFecharCarga
              pedidos={pedidos}
              selecionados={selecionados}
              motoristas={motoristas}
              veiculos={veiculos}
              cargas={cargas}
              onSuccess={() => setSelecionados([])}
            />
            <ProdutosConsolidados pedidosSelecionados={pedidosSelecionados} />
          </div>
        </div>
      )}
    </div>
  );
}