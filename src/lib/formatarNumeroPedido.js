// Remove zeros à esquerda de um número de pedido para EXIBIÇÃO.
// Preserva sufixo não-numérico (ex: pedidos D1 terminam em "D" → "00005D" vira "5D").
// NUNCA usar em filtros/payloads enviados ao Omie.
export function formatNumeroPedido(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  // Mantém qualquer sufixo de letras (D1 etc.) e remove só os zeros do início da parte numérica.
  const m = s.match(/^(\d+)(\D*)$/);
  if (m) {
    const num = m[1].replace(/^0+/, '') || '0';
    return num + m[2];
  }
  return s.replace(/^0+/, '') || '0';
}

export function formatarNumeroPedido(pedido) {
  if (!pedido?.numero_pedido) return '';

  const numeroOriginal = String(pedido.numero_pedido);
  const modeloNota = String(pedido.modelo_nota || '').toLowerCase();
  const tipo = String(pedido.tipo || '').toLowerCase();
  const baseNumerica = numeroOriginal.replace(/\D/g, '');

  const numeroSemSufixo = baseNumerica || numeroOriginal;
  const isNaoFiscal = tipo === 'troca' || (modeloNota && modeloNota !== '55');

  if (isNaoFiscal) {
    return baseNumerica ? `${baseNumerica.padStart(5, '0')}D` : `${numeroOriginal}D`;
  }

  // Remove zeros à esquerda apenas se for numérico puro
  if (/^\d+$/.test(numeroSemSufixo)) {
    return String(Number(numeroSemSufixo)) || '0';
  }

  return numeroSemSufixo;
}