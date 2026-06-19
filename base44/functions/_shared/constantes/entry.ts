export const CONTA_CORRENTE_PADRAO = 11464371392;
export const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
export const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
// Régua REAL de etapas Omie desta empresa (confirmado pelo suporte Omie em 19/06):
// 10=Pedido de Venda | 20=Pedidos Liberados | 50=Faturar (A Faturar) | 60=Faturado | 70=Entrega/Entregue | 80=Cancelado.
// Faturamento manda o pedido 50→60. "Entregue" (70) só é marcado pelo Acerto de Caixa.
export const ETAPAS_OMIE = { '10': 'Pedido de Venda', '20': 'Pedidos Liberados', '50': 'Faturar', '60': 'Faturado', '70': 'Entrega', '80': 'Cancelado' };
export const ETAPA_FATURADO = '60';
export const ETAPA_ENTREGUE = '70';
export const STATUS_ABERTOS_BOLETOS = ['ABERTO', 'ABERTA', 'A_RECEBER'];
export const DELAY_PADRAO_RETRY = 2500;

Deno.serve(() => Response.json({
  arquivo: 'Referência/documentação de constantes compartilhadas. Não importar entre funções.',
  CONTA_CORRENTE_PADRAO,
  ETAPAS_OMIE,
  ETAPA_FATURADO,
  ETAPA_ENTREGUE,
  STATUS_ABERTOS_BOLETOS,
  DELAY_PADRAO_RETRY
}));