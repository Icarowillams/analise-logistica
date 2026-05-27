export const CONTA_CORRENTE_PADRAO = 11464371392;
export const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY") || Deno.env.get("OMIE_API_KEY");
export const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET") || Deno.env.get("OMIE_API_SECRET");
export const ETAPAS_OMIE = { '10': 'faturar', '20': 'separar', '30': 'separado', '40': 'expedido', '50': 'entregue' };
export const STATUS_ABERTOS_BOLETOS = ['ABERTO', 'ABERTA', 'A_RECEBER'];
export const DELAY_PADRAO_RETRY = 2500;

Deno.serve(() => Response.json({
  arquivo: 'Referência/documentação de constantes compartilhadas. Não importar entre funções.',
  CONTA_CORRENTE_PADRAO,
  ETAPAS_OMIE,
  STATUS_ABERTOS_BOLETOS,
  DELAY_PADRAO_RETRY
}));