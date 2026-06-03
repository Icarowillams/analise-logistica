import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import useDadosMontagem from '@/components/cargas/useDadosMontagem';
import StatsCardsMontagem from '@/components/cargas/StatsCardsMontagem';
import PedidosPorRota from '@/components/cargas/PedidosPorRota';
import ProdutosConsolidados from '@/components/cargas/ProdutosConsolidados';
import PainelFecharCarga from '@/components/cargas/PainelFecharCarga';
import MontagemHeader from '@/components/cargas/MontagemHeader';
import MontagemFiltros, { filtrosIniciaisMontagem } from '@/components/cargas/MontagemFiltros';
import CargasEmMontagem from '@/components/cargas/CargasEmMontagem';
import { filtrarPedidosMontagem, getOpcoesMontagem } from '@/components/cargas/montagemUtils';

export default function MontagemCarga() {
  const { loading, pedidos, motoristas, veiculos, cargas, recarregar, carregandoItens } = useDadosMontagem();
  const [selecionados, setSelecionados] = useState([]);
  const [filtros, setFiltros] = useState(filtrosIniciaisMontagem);

  const opcoes = useMemo(() => getOpcoesMontagem(pedidos), [pedidos]);
  const pedidosFiltrados = useMemo(() => filtrarPedidosMontagem(pedidos, filtros, selecionados), [pedidos, filtros, selecionados]);
  const pedidosSelecionados = useMemo(() => pedidos.filter(p => selecionados.includes(p.codigo_pedido)), [pedidos, selecionados]);

  return (
    <div className="min-h-screen -m-3 sm:-m-4 md:-m-6 lg:-m-8 bg-[#eefcff] p-3 md:p-5">
      <div className="space-y-3 w-full max-w-none mx-auto">
        <MontagemHeader loading={loading} onRefresh={recarregar} />

        <Tabs defaultValue="montagem" className="w-full">
          <TabsList>
            <TabsTrigger value="montagem">Cargas em Montagem</TabsTrigger>
            <TabsTrigger value="nova">Nova Carga</TabsTrigger>
          </TabsList>

          <TabsContent value="montagem" className="mt-3">
            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-slate-500 shadow-sm">
                <Loader2 className="w-8 h-8 animate-spin inline text-slate-700" />
                <div className="mt-3 text-sm font-medium">Carregando cargas...</div>
              </div>
            ) : (
              <CargasEmMontagem cargas={cargas} />
            )}
          </TabsContent>

          <TabsContent value="nova" className="mt-3 space-y-3">
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
              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
                <div className="relative">
                  <PedidosPorRota pedidos={pedidosFiltrados} selecionados={selecionados} setSelecionados={setSelecionados} />
                  {carregandoItens && (
                    <div className="absolute bottom-2 right-2 flex items-center gap-2 bg-white/90 px-3 py-1.5 rounded-full shadow text-xs text-slate-500 z-10">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Carregando itens dos pedidos...
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-1 gap-4">
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}