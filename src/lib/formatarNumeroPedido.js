export function formatarNumeroPedido(pedido) {
  if (!pedido?.numero_pedido) return '';

  const numeroOriginal = String(pedido.numero_pedido);
  const modeloNota = String(pedido.modelo_nota || '').toLowerCase();
  const tipo = String(pedido.tipo || '').toLowerCase();

  if (tipo === 'troca') {
    const baseNumerica = numeroOriginal.replace(/\D/g, '');
    return baseNumerica ? `${baseNumerica.padStart(5, '0')}T` : numeroOriginal;
  }

  if (modeloNota === 'd1') {
    const baseNumerica = numeroOriginal.replace(/\D/g, '');
    return baseNumerica ? `${baseNumerica.padStart(5, '0')}D` : numeroOriginal;
  }

  return numeroOriginal;
}