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

export default function PedidoCellRenderer({ col, p, omie, omieRequestPending, carregamentos }) {
  if (col.id === 'status') {
    // Trocas sempre usam status local
    if (p.tipo === 'troca') {
      const trocaLabel = STATUS_LABELS[p.status] || p.status;
      const trocaColors = STATUS_COLORS[p.status] || STATUS_COLORS.pendente;
      return (
        <Badge className={`${trocaColors.bg} ${trocaColors.text} ${trocaColors.border} border text-[10px]`}>
          {trocaLabel}
        </Badge>
      );
    }

    // Status local 'cancelado' é definitivo — SEMPRE prevalece sobre cache Omie
    // Já 'faturado' pode ser cancelado no Omie depois, então NÃO é final
    if (p.status === 'cancelado') {
      const finalColors = STATUS_COLORS.cancelado;
      return (
        <Badge className={`${finalColors.bg} ${finalColors.text} ${finalColors.border} border text-[10px]`}>
          Cancelado
        </Badge>
      );
    }

    // Para vendas/bonificações: priorizar Omie, fallback ao status local
    const omieEtapaLabel = (omie && !omie.erro && !omie.api_bloqueada) ? omie.etapa_label : null;
    const analiseLabel = omieEtapaLabel ? (OMIE_TO_ANALISE[omieEtapaLabel] || omieEtapaLabel) : null;
    
    // Se Omie retornou um status válido, usar ele
    if (analiseLabel) {
      const analiseColors = ANALISE_STATUS_COLORS[analiseLabel] || { bg: 'bg-gray-200', text: 'text-gray-800', border: 'border-gray-400' };
      return (
        <Badge className={`${analiseColors.bg} ${analiseColors.text} ${analiseColors.border} border text-[10px]`}>
          {analiseLabel}
        </Badge>
      );
    }
    
    // Fallback: usar status local (sempre disponível)
    const localLabel = STATUS_LABELS[p.status] || p.status;
    const localColors = STATUS_COLORS[p.status] || STATUS_COLORS.pendente;
    
    // Se está consultando, mostrar indicador sutil
    if (omieRequestPending) {
      return (
        <Badge className={`${localColors.bg} ${localColors.text} ${localColors.border} border text-[10px] animate-pulse`}>
          {localLabel}
        </Badge>
      );
    }
    
    return (
      <Badge className={`${localColors.bg} ${localColors.text} ${localColors.border} border text-[10px]`}>
        {localLabel}
      </Badge>
    );
  }

  // Nº Carregamento (Logística Control) - só para Faturado/Montagem
  if (col.id === 'numero_carregamento') {
    const omieEtapaLabel = (omie && !omie.erro && !omie.api_bloqueada) ? omie.etapa_label : null;
    const analiseLabel = omieEtapaLabel ? (OMIE_TO_ANALISE[omieEtapaLabel] || omieEtapaLabel) : null;
    const localLabel = STATUS_LABELS[p.status] || p.status;
    const statusFinal = analiseLabel || localLabel;
    const mostra = ['Faturado', 'Montagem'].includes(statusFinal);
    if (!mostra) return <span className="block truncate whitespace-nowrap overflow-hidden text-slate-300">-</span>;
    const valor = carregamentos?.[p.id];
    if (valor === undefined) return <span className="block truncate whitespace-nowrap overflow-hidden text-slate-400 animate-pulse text-[10px]">...</span>;
    return <span className="block truncate whitespace-nowrap overflow-hidden font-medium text-blue-700">{valor || '-'}</span>;
  }

  // All cells: single line, truncated with ellipsis
  const truncClass = "block truncate whitespace-nowrap overflow-hidden";

  // Date columns
  if (['data_previsao_entrega', 'data_liberacao', 'data_cancelamento', 'data_envio', 'created_date'].includes(col.id)) {
    return <span className={truncClass}>{formatDate(p[col.field])}</span>;
  }

  // Currency
  if (col.id === 'valor_total') {
    return <span className={`${truncClass} text-right font-medium`}>{formatCurrency(p[col.field])}</span>;
  }

  // Tipo
  if (col.id === 'tipo') {
    return <span className={`${truncClass} capitalize`}>{p[col.field] || '-'}</span>;
  }

  // Numero pedido
  if (col.id === 'numero_pedido') {
    return <span className={`${truncClass} font-medium`}>{p[col.field] || '-'}</span>;
  }

  // Itens
  if (col.id === 'total_itens') {
    return <span className={`${truncClass} text-center`}>{p[col.field] || 0}</span>;
  }

  // Preço Médio
  if (col.id === 'preco_medio') {
    const totalItens = p.total_itens || 0;
    const valorTotal = p.valor_total || 0;
    const precoMedio = totalItens > 0 ? valorTotal / totalItens : 0;
    return <span className={`${truncClass} text-right`}>{formatCurrency(precoMedio)}</span>;
  }

  // Default: all other columns
  const value = p[col.field];
  return <span className={truncClass} title={value || ''}>{value || '-'}</span>;
}

export { STATUS_COLORS, STATUS_LABELS, OMIE_TO_ANALISE, ANALISE_STATUS_COLORS, formatDate, formatCurrency };