import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Truck, PackageX } from 'lucide-react';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

const formatarMoeda = (v) =>
  (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function CargaCard({ carga }) {
  const [aberto, setAberto] = useState(false);

  const pedidos = useMemo(() => {
    const omie = (carga.pedidos_omie || []).map((p) => ({
      numero: formatarNumeroPedido({ numero_pedido: p.numero_pedido, tipo: p.tipo, modelo_nota: p.modelo_nota }),
      cliente: p.nome_fantasia || p.nome_cliente,
      rota: p.rota_cliente,
      valor: p.valor_total_pedido,
    }));
    const internos = (carga.pedidos_internos || []).map((p) => ({
      numero: formatarNumeroPedido({ numero_pedido: p.numero_pedido, tipo: p.tipo, modelo_nota: p.modelo_nota }),
      cliente: p.nome_fantasia || p.nome_cliente,
      rota: p.rota_cliente,
      valor: p.valor_total_pedido,
    }));
    const trocas = (carga.pedidos_troca || []).map((p) => ({
      // pedidos_troca são sempre D1/troca → força o sufixo "D"
      numero: formatarNumeroPedido({ numero_pedido: p.numero_pedido, tipo: 'troca' }),
      cliente: p.nome_fantasia || p.nome_cliente,
      rota: p.rota_cliente,
      valor: p.valor_total_pedido,
    }));
    return [...omie, ...internos, ...trocas];
  }, [carga]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {aberto ? (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-slate-400" />
          )}
          <div className="w-9 h-9 rounded-lg bg-cyan-100 flex items-center justify-center">
            <Truck className="w-5 h-5 text-cyan-700" />
          </div>
          <div>
            <div className="font-semibold text-slate-800">
              Carga {carga.numero_carga || carga.observacao || '—'}
            </div>
            <div className="text-xs text-slate-500">
              {carga.motorista_nome || 'Sem motorista'} ·{' '}
              {carga.veiculo_placa || 'Sem veículo'}
              {carga.data_carga ? ` · ${carga.data_carga}` : ''}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-slate-800">
            {formatarMoeda(carga.valor_total_carga || carga.valor_total)}
          </div>
          <div className="text-xs text-slate-500">{pedidos.length} pedidos</div>
        </div>
      </button>

      {aberto && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 bg-slate-50">
                <th className="px-4 py-2 font-medium">Pedido</th>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Rota</th>
                <th className="px-4 py-2 font-medium text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p, i) => (
                <tr key={`${p.numero}-${i}`} className="border-t border-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-700">{p.numero || '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{p.cliente || '—'}</td>
                  <td className="px-4 py-2 text-slate-500">{p.rota || '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{formatarMoeda(p.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CargasEmMontagem({ cargas }) {
  const cargasMontagem = useMemo(
    () => (cargas || []).filter((c) => c.status_carga === 'montagem'),
    [cargas]
  );

  if (cargasMontagem.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-slate-500 shadow-sm">
        <PackageX className="w-8 h-8 inline text-slate-400" />
        <div className="mt-3 text-sm font-medium">Nenhuma carga em montagem no momento</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cargasMontagem.map((carga) => (
        <CargaCard key={carga.id} carga={carga} />
      ))}
    </div>
  );
}