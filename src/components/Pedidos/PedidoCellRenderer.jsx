import React from 'react';
import { Badge } from '@/components/ui/badge';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

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
  '10': { label: 'Pedido', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  '20': { label: 'Liberados', bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  '50': { label: 'Conferência', bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
  '60': { label: 'Faturado', bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
  '70': { label: 'Entregue', bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
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

// O Status reflete SEMPRE o status local real do pedido (p.status), nada de "promover" pela
// etapa do Omie. A etapa 20 do Omie é "Aguardando faturamento" — NÃO significa que o pedido
// foi liberado no sistema. Promover pendente→liberado pela etapa 20 fazia a coluna Status dizer
// "Liberado" enquanto o filtro "Pendente" (que usa p.status real) ainda o trazia: contradição.
// A etapa real do Omie continua visível na sua própria coluna "Etapa Omie".
const getStatusEfetivo = (p) => p.status;

export default function PedidoCellRenderer({ col, p }) {
  if (col.id === 'status') {
    const statusEfetivo = getStatusEfetivo(p);
    const label = STATUS_LABELS[statusEfetivo] || statusEfetivo;
    const colors = STATUS_COLORS[statusEfetivo] || STATUS_COLORS.pendente;
    return (
      <Badge className={`${colors.bg} ${colors.text} ${colors.border} border text-[10px]`}>
        {label}
      </Badge>
    );
  }

  if (col.id === 'etapa_omie') {
    // Pedidos que nunca vão ao Omie (D1 ou troca)
    if (!p.omie_codigo_pedido && !p.omie_enviado) {
      const isD1 = p.modelo_nota === 'd1';
      const isTroca = p.tipo === 'troca';
      if (isD1 || isTroca) {
        return <span className="block truncate text-slate-300 text-[10px]">{isD1 ? 'D1' : 'Troca'}</span>;
      }
      // Venda 55 ainda PENDENTE (nunca enviada ao Omie) → não é "Sem espelho" (erro),
      // é simplesmente um pedido que ainda não foi liberado/enviado. Mostra estado claro.
      return <Badge className="bg-slate-100 text-slate-500 border-slate-200 border text-[10px]" title="Pedido ainda não enviado ao Omie. O espelho aparece assim que ele for liberado/enviado.">Não enviado</Badge>;
    }
    if (!p.omie_codigo_pedido) {
      // Marcado como enviado mas sem código Omie ainda (envio em andamento na fila).
      return <Badge className="bg-amber-50 text-amber-700 border-amber-200 border text-[10px]" title="Envio ao Omie em andamento. O espelho aparece em instantes.">Enviando…</Badge>;
    }
    // Fonte PRIMÁRIA: etapa do espelho (omie_etapa_real, vindo de PedidoLiberadoOmie).
    // Fallback: Pedido.etapa_omie (se existir). Só "Sem espelho" quando nenhum dos dois tem valor.
    const etapaExibir = p.omie_etapa_real || p.etapa_omie;
    if (!etapaExibir) {
      return <Badge className="bg-slate-100 text-slate-600 border-slate-300 border text-[10px]" title="Pedido não encontrado no espelho. Clique Atualizar para sincronizar.">Sem espelho</Badge>;
    }
    const e = ETAPA_OMIE_LABELS[etapaExibir];
    if (!e) return <span className="block truncate text-[10px]">{etapaExibir}</span>;
    return (
      <Badge className={`${e.bg} ${e.text} ${e.border} border text-[10px]`} title={p.omie_status_label || ''}>
        {etapaExibir} - {e.label}
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
    return <span className={`${truncClass} font-medium`}>{formatarNumeroPedido(p) || '-'}</span>;
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
    const nomeExibir = p.cliente_fantasia_base || p.cliente_nome_base || '-';
    const codExibir = p.cliente_codigo_base || p.cliente_codigo;
    return (
      <span className="block truncate" title={p.cliente_nome_base || ''}>
        {nomeExibir}
        {codExibir ? <span className="text-slate-400 ml-1 font-normal text-[10px]">({codExibir})</span> : null}
        {p.cliente_pendencia_financeira && <Badge className="ml-1 border border-amber-300 bg-amber-100 text-[9px] text-amber-800">Pendência Financeira</Badge>}
      </span>
    );
  }

  if (col.id === 'cliente_nome_fantasia') {
    const codExibir = p.cliente_codigo_base || p.cliente_codigo;
    return (
      <span className="block truncate" title={p.cliente_fantasia_base || ''}>
        {p.cliente_fantasia_base || '-'}
        {codExibir ? <span className="text-slate-400 ml-1 font-normal text-[10px]">({codExibir})</span> : null}
        {p.cliente_pendencia_financeira && <Badge className="ml-1 border border-amber-300 bg-amber-100 text-[9px] text-amber-800">Pendência Financeira</Badge>}
      </span>
    );
  }

  if (col.id === 'usuario_envio') {
    return <span className={truncClass} title={p.usuario_envio || ''}>{p.usuario_envio || '-'}</span>;
  }

  const value = p[col.field];
  return <span className={truncClass} title={value || ''}>{value || '-'}</span>;
}

export { STATUS_COLORS, STATUS_LABELS, formatDate, formatCurrency };