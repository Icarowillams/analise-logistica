import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PedidosBuscaCarga from '@/components/cargas/PedidosBuscaCarga';
import PedidosTabelaSelecao from '@/components/cargas/PedidosTabelaSelecao';
import CargaFormModal from '@/components/cargas/CargaFormModal';

export default function MontagemCarga() {
  const navigate = useNavigate();
  const [pedidos, setPedidos] = useState([]);
  const [selecionados, setSelecionados] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

  const pedidosSelecionados = pedidos.filter(p => selecionados.includes(p.codigo_pedido));

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Truck className="w-8 h-8 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold">Montagem de Carga</h1>
            <p className="text-sm text-slate-500">Seleciona pedidos Omie, atribui motorista/veículo e cria uma carga</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/Cargas')}>Ver cargas</Button>
          <Button disabled={selecionados.length === 0} onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Criar carga ({selecionados.length})
          </Button>
        </div>
      </div>

      <PedidosBuscaCarga onResultado={(p) => { setPedidos(p); setSelecionados([]); }} />

      {pedidos.length > 0 && (
        <PedidosTabelaSelecao pedidos={pedidos} selecionados={selecionados} setSelecionados={setSelecionados} />
      )}

      <CargaFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        pedidosSelecionados={pedidosSelecionados}
        onCargaCriada={() => { setSelecionados([]); navigate('/Cargas'); }}
      />
    </div>
  );
}