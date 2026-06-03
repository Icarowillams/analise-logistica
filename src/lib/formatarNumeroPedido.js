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