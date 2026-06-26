// FONTE ÚNICA DE VERDADE do Status na aba "Gerenciar Pedidos".
// A tela é o espelho em tempo real do Omie: o Status deriva da ETAPA do espelho
// (PedidoLiberadoOmie.etapa), NÃO de status/status_faturamento do Pedido.
//
// Mapa de etapas Omie:
//   10 = Pendente · 20 = Liberado · 50 = Faturar · 60 = Faturado · 99 = Cancelado
//
// O MESMO helper é usado pela coluna Status (PedidoCellRenderer) e pelo filtro de status,
// garantindo que coluna e filtro SEMPRE concordem.

// etapa Omie → chave de status interna
const ETAPA_PARA_STATUS = {
  '10': 'pendente',
  '20': 'liberado',
  '50': 'faturar',
  '60': 'faturado',
  '70': 'faturado',
  '99': 'cancelado',
};

// Resolve o status efetivo do pedido a partir da etapa do espelho.
// Estados finais LOCAIS (cancelado) não são sobrescritos pela etapa.
// Sem etapa do espelho → cai no status local do Pedido.
export function getStatusEfetivoPedido(p) {
  if (p.status === 'cancelado' || p.status === 'cancelado_pos_faturamento') return p.status;
  const etapa = p.omie_etapa_real || p.etapa_omie;
  if (etapa && ETAPA_PARA_STATUS[etapa]) return ETAPA_PARA_STATUS[etapa];
  return p.status;
}

// Chave do filtro (analise_*) → status efetivo correspondente.
export const FILTRO_PARA_STATUS_EFETIVO = {
  'analise_pendente': ['pendente', 'enviado'],
  'analise_liberado': ['liberado'],
  'analise_montagem': ['montagem'],
  'analise_faturado': ['faturado', 'faturar'],
  'analise_cancelado': ['cancelado', 'cancelado_pos_faturamento'],
};

export { ETAPA_PARA_STATUS };