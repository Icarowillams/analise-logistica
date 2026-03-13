import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Store } from 'lucide-react';

export default function ClienteTab({ visitasRoteiroFiltradas, visitasFiltradas, vendedoresMap, visitaPedidoMap, tipo }) {
  const [selectedMotivo, setSelectedMotivo] = useState(null);

  // Build client data with motivos
  const { motivos, clientes, totalGeral } = useMemo(() => {
    const clienteMap = {};
    const motivoMap = {};

    visitasRoteiroFiltradas.forEach(v => {
      if (tipo === 'naoVisita') {
        if (v.status !== 'nao_atendido') return;
        const motivo = v.motivo_nao_atendimento || 'Sem motivo informado';
        const cid = v.cliente_id;
        const nome = v.cliente_nome || v.cliente_codigo || 'Sem Nome';
        if (!clienteMap[cid]) clienteMap[cid] = { clienteId: cid, nome, codigo: v.cliente_codigo, cidade: v.cliente_cidade, total: 0, motivos: {} };
        clienteMap[cid].total++;
        clienteMap[cid].motivos[motivo] = (clienteMap[cid].motivos[motivo] || 0) + 1;
        motivoMap[motivo] = (motivoMap[motivo] || 0) + 1;
      } else {
        if (v.status !== 'concluida' && v.status !== 'checkin_realizado' && v.status !== 'em_andamento') return;
        const pedido = v.pedido_solicitado != null
          ? v.pedido_solicitado
          : visitaPedidoMap[`${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`];
        if (pedido !== false) return;
        let motivo = v.motivo_nao_pedido;
        if (!motivo) {
          const visitaKey = `${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`;
          const visitaEntidade = visitasFiltradas.find(vi =>
            `${vi.vendedor_id}_${vi.cliente_id}_${vi.data_visita}` === visitaKey
          );
          motivo = visitaEntidade?.motivo_nao_solicitacao_descricao;
        }
        motivo = motivo || 'Sem motivo informado';
        const cid = v.cliente_id;
        const nome = v.cliente_nome || v.cliente_codigo || 'Sem Nome';
        if (!clienteMap[cid]) clienteMap[cid] = { clienteId: cid, nome, codigo: v.cliente_codigo, cidade: v.cliente_cidade, total: 0, motivos: {} };
        clienteMap[cid].total++;
        clienteMap[cid].motivos[motivo] = (clienteMap[cid].motivos[motivo] || 0) + 1;
        motivoMap[motivo] = (motivoMap[motivo] || 0) + 1;
      }
    });

    const motivosArr = Object.entries(motivoMap)
      .map(([motivo, total]) => ({ motivo, total }))
      .sort((a, b) => b.total - a.total);

    let clientesArr = Object.values(clienteMap).sort((a, b) => b.total - a.total);
    const totalGeral = clientesArr.reduce((s, c) => s + c.total, 0);

    return { motivos: motivosArr, clientes: clientesArr, totalGeral };
  }, [visitasRoteiroFiltradas, visitasFiltradas, visitaPedidoMap, tipo]);

  const filteredClientes = useMemo(() => {
    if (!selectedMotivo) return clientes;
    return clientes
      .filter(c => c.motivos[selectedMotivo])
      .map(c => ({ ...c, total: c.motivos[selectedMotivo] }))
      .sort((a, b) => b.total - a.total);
  }, [clientes, selectedMotivo]);

  if (totalGeral === 0) {
    return <p className="text-sm text-slate-500 text-center py-6">Nenhum registro encontrado no período.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Motivos clicáveis */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Filtrar por motivo</p>
        <div className="flex flex-wrap gap-2">
          {motivos.map(m => {
            const isActive = selectedMotivo === m.motivo;
            return (
              <button
                key={m.motivo}
                onClick={() => setSelectedMotivo(isActive ? null : m.motivo)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                  isActive
                    ? 'bg-red-100 border-red-300 text-red-800 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                {m.motivo}
                <span className={`font-bold ${isActive ? 'text-red-600' : 'text-slate-800'}`}>{m.total}</span>
              </button>
            );
          })}
        </div>
        {selectedMotivo && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedMotivo(null)} className="mt-2 h-6 px-2 text-xs text-slate-400">
            <X className="w-3 h-3 mr-1" /> Limpar filtro
          </Button>
        )}
      </div>

      {/* Lista de clientes */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Store className="w-4 h-4 text-slate-500" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Clientes ({filteredClientes.length})
          </p>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {filteredClientes.map((c, idx) => {
            const isTop10 = idx < 10;
            return (
              <div
                key={c.clienteId}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                  isTop10
                    ? 'bg-red-50/70 border-red-200/60'
                    : 'bg-white border-slate-100'
                }`}
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isTop10 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${isTop10 ? 'font-semibold text-red-800' : 'font-medium text-slate-700'}`}>
                    {c.nome}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {[c.codigo, c.cidade].filter(Boolean).join(' • ')}
                  </p>
                </div>
                <span className={`text-sm font-bold ${isTop10 ? 'text-red-600' : 'text-slate-700'}`}>{c.total}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}