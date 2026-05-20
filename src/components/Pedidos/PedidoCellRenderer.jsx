import React from 'react';
import { Badge } from '@/components/ui/badge';

const STATUS_COLORS = {
  pendente: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
  enviado: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
  liberado: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
  montagem: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  faturado: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
  cancelado: { bg: 'bg-gray-700', text: 'text-white', border: 'border-gray-700' },
};

const STATUS_LABELS = {
  pendente: 'Pendente',
  enviado: 'Pendente',
  liberado: 'Liberado',
  montagem: 'Montagem',
  faturado: 'Faturado',
  cancelado: 'Cancelado',
};

const formatDate = (d) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
};

const formatDateTime = (d) => {
  if (!d) return '-';
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatCurrency = (v) => {
  if (v == null) return '-';
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
};

const ETAPA_OMIE_LABELS = {
  '10': { label: 'Pedido Venda', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  '20': { label: 'Liberados', bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  '50': { label: 'Faturar', bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
  '60': { label: 'Faturado', bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
};

const formatNumeroPedido = (pedido) => {
  if (!pedido?.numero_pedido) return '-';
  if (pedido.tipo !== 'troca') return pedido.numero_pedido;
  const digits = String(pedido.numero_pedido).replace(/\D/g, '');
  return `${digits.padStart(5, '0')}T`;
};

const NF_STATUS_LABELS = {
  emitida:       { label: 'NF Emitida',       bg: 'bg-green-100',  text: 'text-green-800',  border: 'border-green-300' },
  rejeitada:     { label: 'NF-e Rejeitada',   bg: 'bg-red-100',    text: 'text-red-800',    border: 'border-red-300' },
  cancelada:     { label: 'NF Cancelada',     bg: 'bg-gray-200',   text: 'text-gray-800',   border: 'border-gray-400' },
  denegada:      { label: 'NF Denegada',      bg: 'bg-red-100',    text: 'text-red-800',    border: 'border-red-300' },
  aguardando_nf: { label: 'Aguardando NF',    bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
};

const getErroFiscal = (p) => {
  const erro = String(p.omie_erro || '').toLowerCase();
  if (erro.includes('rejeitad')) return NF_STATUS_LABELS.rejeitada;
  if (erro.includes('denegad')) return NF_STATUS_LABELS.denegada;
  return null;
};

export default function PedidoCellRenderer({ col, p }) {
  const erroFiscal = getErroFiscal(p);

  if (col.id === 'status') {
    if (erroFiscal) {
      return (
        <Badge className={`${erroFiscal.bg} ${erroFiscal.text} ${erroFiscal.border} border text-[10px]`} title={p.omie_erro || ''}>
          {erroFiscal.label}
        </Badge>
      );
    }

    const label = STATUS_LABELS[p.status] || p.status;
    const colors = STATUS_COLORS[p.status] || STATUS_COLORS.pendente;
    return (
      <Badge className={`${colors.bg} ${colors.text} ${colors.border} border text-[10px]`}>
        {label}
      </Badge>
    );
  }

  if (col.id === 'etapa_omie') {
    if (!p.omie_codigo_pedido) {
      return <span className="block truncate text-slate-300 text-[10px]">—</span>;
    }
    if (!p.omie_etapa_real) {
      return <Badge className="bg-slate-100 text-slate-600 border-slate-300 border text-[10px]">Sincronizando…</Badge>;
    }
    const e = ETAPA_OMIE_LABELS[p.omie_etapa_real];
    if (!e) return <span className="block truncate text-[10px]">{p.omie_etapa_real}</span>;
    // Etapa 60 + status NF detalhado
    if (p.omie_etapa_real === '60' && p.omie_status_nf && NF_STATUS_LABELS[p.omie_status_nf]) {
      const nf = NF_STATUS_LABELS[p.omie_status_nf];
      return (
        <Badge className={`${nf.bg} ${nf.text} ${nf.border} border text-[10px]`} title={p.omie_status_label || ''}>
          {nf.label}
        </Badge>
      );
    }
    return (
      <Badge className={`${e.bg} ${e.text} ${e.border} border text-[10px]`}>
        {e.label}
      </Badge>
    );
  }

  if (col.id === 'numero_nf') {
    if (!p.omie_numero_nf) return <span className="block truncate text-slate-300 text-[10px]">—</span>;
    return <span className="block truncate font-medium text-[10px] text-green-700">{p.omie_numero_nf}</span>;
  }

  const truncClass = "block truncate whitespace-nowrap overflow-hidden";

  if (col.id === 'numero_carga') {
    return <span className={`${truncClass} font-medium text-blue-700`}>{p.numero_carga || '-'}</span>;
  }

  if (['data_liberacao', 'data_cancelamento'].includes(col.id)) {
    return <span className={truncClass}>{formatDateTime(p[col.field])}</span>;
  }

  if (['data_previsao_entrega', 'data_envio', 'created_date'].includes(col.id)) {
    return <span className={truncClass}>{formatDate(p[col.field])}</span>;
  }

  if (col.id === 'valor_total') {
    return <span className={`${truncClass} text-right font-medium`}>{formatCurrency(p[col.field])}</span>;
  }

  if (col.id === 'tipo') {
    // Tipo é normalizado por operação (venda/troca/bonificação/devolução), não pelo nome do cenário fiscal.
    // Pedidos D1 e 55 com mesma operação devem mostrar o MESMO rótulo para filtros e análises consistentes.
    const tipo = p[col.field];
    const TIPO_LABELS = { venda: 'Venda', troca: 'Troca', bonificacao: 'Bonificação', devolucao: 'Devolução' };
    const tipoLabel = TIPO_LABELS[tipo] || tipo || '-';
    return <span className={truncClass}>{tipoLabel}</span>;
  }

  if (col.id === 'numero_pedido') {
    return <span className={`${truncClass} font-medium`}>{formatNumeroPedido(p)}</span>;
  }

  if (col.id === 'total_itens') {
    return <span className={`${truncClass} text-center`}>{p[col.field] || 0}</span>;
  }

  if (col.id === 'preco_medio') {
    // Preço médio = valor total do pedido ÷ quantidade total dos itens (soma das quantidades)
    const qtdTotal = p.qtd_total_itens || p.total_itens || 0;
    const valorTotal = p.valor_total || 0;
    const precoMedio = qtdTotal > 0 ? valorTotal / qtdTotal : 0;
    return <span className={`${truncClass} text-right`}>{formatCurrency(precoMedio)}</span>;
  }

  if (col.id === 'cliente_codigo') {
    const codigo = p.cliente_codigo_base || p.cliente_codigo;
    return <span className={truncClass} title={codigo || ''}>{codigo || '-'}</span>;
  }

  if (col.id === 'cliente_nome') {
    return <span className={truncClass} title={p.cliente_nome_base || ''}>{p.cliente_nome_base || '-'}</span>;
  }

  if (col.id === 'cliente_nome_fantasia') {
    return <span className={truncClass} title={p.cliente_fantasia_base || ''}>{p.cliente_fantasia_base || '-'}</span>;
  }

  if (col.id === 'usuario_envio') {
    return <span className={truncClass} title={p.usuario_envio || ''}>{p.usuario_envio || '-'}</span>;
  }

  const value = p[col.field];
  return <span className={truncClass} title={value || ''}>{value || '-'}</span>;
}

export { STATUS_COLORS, STATUS_LABELS, formatDate, formatCurrency };