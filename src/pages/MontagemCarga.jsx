import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import useDadosMontagem from '@/components/cargas/useDadosMontagem';
import StatsCardsMontagem from '@/components/cargas/StatsCardsMontagem';
import PedidosPorRota from '@/components/cargas/PedidosPorRota';
import ProdutosConsolidados from '@/components/cargas/ProdutosConsolidados';
import PainelFecharCarga from '@/components/cargas/PainelFecharCarga';
import MontagemHeader from '@/components/cargas/MontagemHeader';
import MontagemFiltros, { filtrosIniciaisMontagem } from '@/components/cargas/MontagemFiltros';
import { filtrarPedidosMontagem, getOpcoesMontagem } from '@/components/cargas/montagemUtils';

export default function MontagemCarga() {
  const { loading, pedidos, motoristas, veiculos, cargas, recarregar } = useDadosMontagem();
  const [selecionados, setSelecionados] = useState([]);
  const [filtros, setFiltros] = useState(filtrosIniciaisMontagem);

  const opcoes = useMemo(() => getOpcoesMontagem(pedidos), [pedidos]);
  const pedidosFiltrados = useMemo(() => filtrarPedidosMontagem(pedidos, filtros, selecionados), [pedidos, filtros, selecionados]);
  const pedidosSelecionados = useMemo(() => pedidos.filter(p => selecionados.includes(p.codigo_pedido)), [pedidos, selecionados]);

  return (
    <div className="min-h-screen -m-3 sm:-m-4 md:-m-6 lg:-m-8 bg-[#eefcff] p-4 md:p-6">
      <div className="space-y-3 max-w-[1760px] mx-auto">
        <MontagemHeader loading={loading} onRefresh={recarregar} />
        <StatsCardsMontagem pedidos={pedidosFiltrados} selecionados={selecionados} />
        <MontagemFiltros
          filtros={filtros}
          setFiltros={setFiltros}
          opcoes={opcoes}
          total={pedidos.length}
          filtrados={pedidosFiltrados.length}
          selecionados={selecionados.length}
        />

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-slate-500 shadow-sm">
            <Loader2 className="w-8 h-8 animate-spin inline text-slate-700" />
            <div className="mt-3 text-sm font-medium">Carregando pedidos Omie e trocas aprovadas...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
            <PedidosPorRota pedidos={pedidosFiltrados} selecionados={selecionados} setSelecionados={setSelecionados} />
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
    </div>
  );
}