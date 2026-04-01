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

const formatCurrency = (v) => {
  if (v == null) return '-';
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
};

export default function PedidoCellRenderer({ col, p }) {
  if (col.id === 'status') {
    const label = STATUS_LABELS[p.status] || p.status;
    const colors = STATUS_COLORS[p.status] || STATUS_COLORS.pendente;
    return (
      <Badge className={`${colors.bg} ${colors.text} ${colors.border} border text-[10px]`}>
        {label}
      </Badge>
    );
  }

  // Nº Carregamento — usa campo numero_carga salvo no banco
  if (col.id === 'numero_carregamento') {
    const mostra = ['montagem', 'faturado'].includes(p.status);
    if (!mostra) return <span className="block truncate whitespace-nowrap overflow-hidden text-slate-300">-</span>;
    return <span className="block truncate whitespace-nowrap overflow-hidden font-medium text-blue-700">{p.numero_carga || '-'}</span>;
  }

  const truncClass = "block truncate whitespace-nowrap overflow-hidden";

  if (['data_previsao_entrega', 'data_liberacao', 'data_cancelamento', 'data_envio', 'created_date'].includes(col.id)) {
    return <span className={truncClass}>{formatDate(p[col.field])}</span>;
  }

  if (col.id === 'valor_total') {
    return <span className={`${truncClass} text-right font-medium`}>{formatCurrency(p[col.field])}</span>;
  }

  if (col.id === 'tipo') {
    return <span className={`${truncClass} capitalize`}>{p[col.field] || '-'}</span>;
  }

  if (col.id === 'numero_pedido') {
    return <span className={`${truncClass} font-medium`}>{p[col.field] || '-'}</span>;
  }

  if (col.id === 'total_itens') {
    return <span className={`${truncClass} text-center`}>{p[col.field] || 0}</span>;
  }

  if (col.id === 'preco_medio') {
    const totalItens = p.total_itens || 0;
    const valorTotal = p.valor_total || 0;
    const precoMedio = totalItens > 0 ? valorTotal / totalItens : 0;
    return <span className={`${truncClass} text-right`}>{formatCurrency(precoMedio)}</span>;
  }

  if (col.id === 'cliente_codigo') {
    return <span className={truncClass} title={p.cliente_codigo || ''}>{p.cliente_codigo || '-'}</span>;
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