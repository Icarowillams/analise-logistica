import React from 'react';
import { ChevronRight, MapPin, User, Package, Receipt, AlertCircle } from 'lucide-react';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

// Card mais rico que mostra TUDO que o Omie tem sobre o pedido
export default function CardPedidoKanban({
  pedido,
  borderColor,
  origemLabel,
  acaoLabel,
  acaoColor = 'amber',
  onAvancar,
  onClick,
  draggable,
  onDragStart
}) {
  const valor = Number(pedido.valor_total_pedido || 0);
  const valorNf = Number(pedido.valor_nf || 0);
  const itens = pedido.quantidade_itens || 0;

  const houveCorteNf = pedido.numero_nf && valorNf > 0 && Math.abs(valor - valorNf) > 0.01;

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      className="group bg-white rounded-md border border-slate-200 p-3 mb-2 hover:shadow-lg hover:border-slate-300 transition-all relative"
      style={{ borderLeft: `3px solid ${borderColor}`, cursor: draggable ? 'grab' : 'pointer' }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ped</span>
        <span className="text-xs font-bold text-slate-700">#{pedido.numero_pedido ? formatarNumeroPedido(pedido) : pedido.codigo_pedido}</span>
        {pedido.numero_nf && (
          <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 flex items-center gap-1">
            <Receipt className="w-2.5 h-2.5" /> NF {pedido.numero_nf}
          </span>
        )}
      </div>

      <div className="font-bold text-sm text-slate-800 truncate mt-1" title={pedido.nome_fantasia || pedido.cliente_nome}>
        {pedido.nome_fantasia || pedido.cliente_nome || `Cliente ${pedido.codigo_cliente}`}
        {pedido.codigo_interno ? <span className="text-slate-400 font-normal ml-1">({pedido.codigo_interno})</span> : null}
      </div>

      {(pedido.cliente_cidade || pedido.rota_nome) && (
        <div className="text-[11px] text-slate-500 truncate mt-0.5 flex items-center gap-1">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          {[pedido.cliente_cidade, pedido.rota_nome].filter(Boolean).join(' · ')}
        </div>
      )}

      {pedido.vendedor_nome && (
        <div className="text-[11px] text-slate-500 truncate mt-0.5 flex items-center gap-1">
          <User className="w-3 h-3 flex-shrink-0" />
          {pedido.vendedor_nome}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="text-sm font-bold text-emerald-600">
          R$ {valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </span>
        {houveCorteNf && (
          <span className="text-[10px] text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded font-semibold" title={`NF: R$ ${valorNf.toFixed(2)}`}>
            NF: {valorNf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </span>
        )}
        {itens > 0 && (
          <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
            <Package className="w-2.5 h-2.5" /> {itens} {itens === 1 ? 'item' : 'itens'}
          </span>
        )}
        {pedido.data_previsao && (
          <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
            {pedido.data_previsao}
          </span>
        )}
      </div>

      {pedido.cliente_encontrado === false && (
        <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded mt-1.5 flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" />
          Cliente não vinculado ao Base44
        </div>
      )}

      <div className="text-[10px] text-slate-400 mt-1.5">{origemLabel}</div>

      {acaoLabel && onAvancar && (
        <button
          onClick={(e) => { e.stopPropagation(); onAvancar(); }}
          className={`mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-md bg-${acaoColor}-50 text-${acaoColor}-700 hover:bg-${acaoColor}-500 hover:text-white border border-${acaoColor}-200 transition-colors opacity-0 group-hover:opacity-100`}
        >
          {acaoLabel}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}