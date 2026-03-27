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

const OMIE_TO_ANALISE = {
  'Pedido de Venda': 'Pendente',
  'Pedidos Liberados': 'Liberados',
  'Faturar': 'Montagem',
  'Faturado': 'Faturado',
  'Entrega': 'Faturado',
  'Cancelado': 'Cancelado',
  'Excluído no Omie': 'Cancelado',
};

const ANALISE_STATUS_COLORS = {
  'Pendente': { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
  'Liberados': { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
  'Montagem': { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  'Faturado': { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
  'Cancelado': { bg: 'bg-gray-700', text: 'text-white', border: 'border-gray-700' },
  'Omie Bloqueado': { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
  'Falha na Consulta': { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
};

const formatDate = (d) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR');
};

const formatCurrency = (v) => {
  if (v == null) return '-';
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
};

export default function PedidoCellRenderer({ col, p, omie, omieRequestPending }) {
  if (col.id === 'status') {
    const omieEtapaLabel = omie?.erro ? null : omie?.etapa_label;
    const analiseLabel = omieEtapaLabel ? (OMIE_TO_ANALISE[omieEtapaLabel] || omieEtapaLabel) : null;
    const displayLabel = omie?.api_bloqueada
      ? 'Omie Bloqueado'
      : omie?.erro
        ? 'Falha na Consulta'
        : analiseLabel;
    const analiseColors = displayLabel ? (ANALISE_STATUS_COLORS[displayLabel] || { bg: 'bg-gray-200', text: 'text-gray-800', border: 'border-gray-400' }) : null;

    if (p.tipo === 'troca') {
      const trocaLabel = STATUS_LABELS[p.status] || p.status;
      const trocaColors = STATUS_COLORS[p.status] || STATUS_COLORS.pendente;
      return (
        <Badge className={`${trocaColors.bg} ${trocaColors.text} ${trocaColors.border} border text-[10px]`}>
          {trocaLabel}
        </Badge>
      );
    }
    if (displayLabel) {
      return (
        <Badge className={`${analiseColors.bg} ${analiseColors.text} ${analiseColors.border} border text-[10px]`}>
          {displayLabel}
        </Badge>
      );
    }
    return (
      <Badge className="bg-slate-100 text-slate-700 border-slate-300 border text-[10px]">
        {p.omie_enviado && omieRequestPending ? 'Consultando Omie...' : 'Aguardando Omie'}
      </Badge>
    );
  }

  // Date columns
  if (['data_previsao_entrega', 'data_liberacao', 'data_cancelamento', 'data_envio', 'created_date'].includes(col.id)) {
    return <span className="whitespace-nowrap">{formatDate(p[col.field])}</span>;
  }

  // Currency
  if (col.id === 'valor_total') {
    return <span className="text-right font-medium whitespace-nowrap">{formatCurrency(p[col.field])}</span>;
  }

  // Tipo
  if (col.id === 'tipo') {
    return <span className="capitalize">{p[col.field] || '-'}</span>;
  }

  // Numero pedido
  if (col.id === 'numero_pedido') {
    return <span className="font-medium">{p[col.field] || '-'}</span>;
  }

  // Itens
  if (col.id === 'total_itens') {
    return <span className="text-center">{p[col.field] || 0}</span>;
  }

  // Preço Médio (computed: valor_total / total_itens)
  if (col.id === 'preco_medio') {
    const totalItens = p.total_itens || 0;
    const valorTotal = p.valor_total || 0;
    const precoMedio = totalItens > 0 ? valorTotal / totalItens : 0;
    return <span className="text-right whitespace-nowrap">{formatCurrency(precoMedio)}</span>;
  }

  // Usuário Envio
  if (col.id === 'usuario_envio') {
    return <span className="max-w-[120px] truncate block" title={p.created_by}>{p.created_by || '-'}</span>;
  }

  // Truncated columns
  if (['cliente_nome', 'cliente_nome_fantasia', 'plano_pagamento_nome', 'tabela_preco_nome', 'motivo_cancelamento'].includes(col.id)) {
    return <span className="max-w-[120px] truncate block" title={p[col.field]}>{p[col.field] || '-'}</span>;
  }

  // Default
  return <span>{p[col.field] || '-'}</span>;
}

export { STATUS_COLORS, STATUS_LABELS, OMIE_TO_ANALISE, ANALISE_STATUS_COLORS, formatDate, formatCurrency };