// ─────────────────────────────────────────────────────────────────────────────
// Helper CENTRAL de EXIBIÇÃO do número do pedido.
// No banco todo numero_pedido vem com padding de 15 dígitos ("000000000001456").
// O espelho Omie expõe limpo ("1456"). Para manter a UI consistente, SEMPRE exibir
// vendas/bonificações sem zeros à esquerda — e preservar trocas exatas.
//
// ⚠️ USO EXCLUSIVO DE EXIBIÇÃO (label). NUNCA usar o retorno como chave de seleção,
// dedup, filtro/busca ou payload enviado ao Omie/backend — a chave interna continua
// zero-padded.
//
// Regra:
//  - Troca (tipo === 'troca') ou ID terminado em "D" (ex "00711D"): retorna SEM alterar.
//  - Numérico puro (venda/bonificação): remove zeros à esquerda.
//  - null/undefined/vazio: retorna ''.
//
// Aceita DUAS formas de chamada (compatibilidade):
//  - formatarNumeroPedido(numero, tipo)   → ex: ('000...1456', 'venda')
//  - formatarNumeroPedido(pedido)         → objeto { numero_pedido, tipo }
// ─────────────────────────────────────────────────────────────────────────────
export function formatarNumeroPedido(numeroOuPedido, tipo) {
  let numero = numeroOuPedido;
  let tipoPedido = tipo;

  // Compatibilidade: se receberam o objeto pedido inteiro, extrai os campos.
  if (numeroOuPedido && typeof numeroOuPedido === 'object') {
    numero = numeroOuPedido.numero_pedido;
    tipoPedido = numeroOuPedido.tipo;
  }

  const s = String(numero ?? '').trim();
  if (!s) return '';
  // Trocas e qualquer ID terminado em "D" preservam zeros e o sufixo.
  if (String(tipoPedido || '').toLowerCase() === 'troca' || /D$/i.test(s)) return s;
  // Numérico puro: remove zeros à esquerda (mantém ao menos 1 dígito).
  if (/^\d+$/.test(s)) return s.replace(/^0+/, '') || s;
  // Qualquer outro formato (já limpo, com letras no meio, etc.): devolve como está.
  return s;
}

// Alias de compatibilidade: recebe só o número (sem tipo).
export function formatNumeroPedido(v) {
  return formatarNumeroPedido(v);
}