import React, { useMemo, useState } from 'react';
import DiaRoteiroCard from './DiaRoteiroCard';
import ClienteVisitaDialog from './ClienteVisitaDialog';
import { DIAS_SEMANA, normalizarDia } from './roteirosUtils';

export default function MeusRoteiros({ vendedor, roteiros, visitas, pedidos, onRefresh }) {
  const [selecionado, setSelecionado] = useState(null);
  const roteirosDoVendedor = useMemo(() => roteiros.filter(r => r.vendedor_id === vendedor?.id), [roteiros, vendedor]);

  const abrirCliente = (roteiro, cliente, visita) => setSelecionado({ roteiro, cliente, visita });

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-cyan-50 border border-cyan-200 p-4 text-cyan-900">
        Meus roteiros semanais — clique em um cliente para registrar a execução da visita em campo.
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {DIAS_SEMANA.map(dia => (
          <DiaRoteiroCard
            key={dia.key}
            dia={dia}
            roteiro={roteirosDoVendedor.find(r => normalizarDia(r.dia_semana) === dia.key)}
            visitas={visitas}
            onClienteClick={abrirCliente}
          />
        ))}
      </div>
      <ClienteVisitaDialog
        open={!!selecionado}
        onOpenChange={() => setSelecionado(null)}
        roteiro={selecionado?.roteiro}
        cliente={selecionado?.cliente}
        visita={selecionado?.visita}
        pedidos={pedidos}
        onSaved={onRefresh}
      />
    </div>
  );
}