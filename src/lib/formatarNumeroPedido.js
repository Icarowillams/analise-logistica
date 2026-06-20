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
//  - formatarNumeroPedido(pedido)         → objeto { numero_pedido, tipo, modelo_nota, cenario_local_tipo }
//
// IDENTIFICAÇÃO DE TROCA/D1 (fonte confiável — NÃO confiar no "D" gravado no número,
// que está inconsistente no banco): tipo === 'troca' OU modelo_nota !== '55' (ex 'd1')
// OU cenario_local_tipo === 'troca'. Toda troca/D1 SEMPRE exibe sufixo "D".
// ─────────────────────────────────────────────────────────────────────────────
export function formatarNumeroPedido(numeroOuPedido, tipo) {
  let numero = numeroOuPedido;
  let tipoPedido = tipo;
  let modeloNota;
  let cenarioLocalTipo;

  // Compatibilidade: se receberam o objeto pedido inteiro, extrai os campos.
  if (numeroOuPedido && typeof numeroOuPedido === 'object') {
    numero = numeroOuPedido.numero_pedido;
    tipoPedido = numeroOuPedido.tipo;
    modeloNota = numeroOuPedido.modelo_nota;
    cenarioLocalTipo = numeroOuPedido.cenario_local_tipo;
  }

  const s = String(numero ?? '').trim();
  if (!s) return '';

  const tipoLower = String(tipoPedido || '').toLowerCase();
  const isTroca =
    tipoLower === 'troca' ||
    tipoLower === 'd1' ||
    String(cenarioLocalTipo || '').toLowerCase() === 'troca' ||
    (modeloNota != null && String(modeloNota) !== '55') ||
    /D$/i.test(s);

  if (isTroca) {
    // Sufixo "D" SEMPRE. Base numérica → padroniza em 5 dígitos (00767D); senão, anexa "D".
    const baseNumerica = s.replace(/D$/i, '').replace(/^0+/, '');
    if (/^\d+$/.test(baseNumerica)) return `${baseNumerica.padStart(5, '0')}D`;
    return /D$/i.test(s) ? s : `${s}D`;
  }

  // Venda/bonificação numérica pura: remove zeros à esquerda (mantém ao menos 1 dígito).
  if (/^\d+$/.test(s)) return s.replace(/^0+/, '') || s;
  // Qualquer outro formato (já limpo, com letras no meio, etc.): devolve como está.
  return s;
}

// Alias de compatibilidade: recebe só o número (sem tipo).
export function formatNumeroPedido(v) {
  return formatarNumeroPedido(v);
}