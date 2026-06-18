export const CONTA_CORRENTE_PADRAO = 11464371392;
export const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
export const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
// Mapa de etapas Omie desta empresa. ATENÇÃO: '50' = "Entregue" e '60' = "Faturado".
// Faturamento manda o pedido para 60 (Faturado). "Entregue" (50) só é marcado pelo Acerto de Caixa.
export const ETAPAS_OMIE = { '10': 'faturar', '20': 'separar', '30': 'separado', '40': 'expedido', '50': 'entregue', '60': 'faturado' };
export const ETAPA_FATURADO = '60';
export const ETAPA_ENTREGUE = '50';
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