// Helpers compartilhados pelos documentos de carga / pedido

export function abrirImpressao(html, titulo = 'Documento') {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Permita pop-ups para imprimir o documento.');
    return;
  }
  win.document.write(`<html><head><title>${titulo}</title><meta charset="utf-8" /></head><body>${html}</body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 300);
}

export function imprimirElemento(elemento, titulo = 'Documento') {
  if (!elemento) return;
  abrirImpressao(elemento.innerHTML, titulo);
}

export const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtInt = (v) => Number(v || 0).toLocaleString('pt-BR');
export const fmtDate = (v) => {
  if (!v) return '';
  try {
    const d = typeof v === 'string' && v.length === 10 ? new Date(v + 'T12:00:00') : new Date(v);
    return d.toLocaleDateString('pt-BR');
  } catch { return ''; }
};
export const fmtDateTime = (v) => {
  if (!v) return '';
  try { return new Date(v).toLocaleString('pt-BR'); } catch { return ''; }
};

// Consolida produtos de uma lista de pedidos (cada pedido tem array produtos[])
export function consolidarProdutos(pedidos = []) {
  const mapa = new Map();
  pedidos.forEach(p => {
    (p.produtos || []).forEach(prod => {
      const key = prod.codigo_produto || prod.descricao || 'sem-codigo';
      const atual = mapa.get(key) || {
        codigo_produto: prod.codigo_produto || '',
        descricao: prod.descricao || '',
        unidade: prod.unidade || 'UN',
        quantidade: 0
      };
      atual.quantidade += Number(prod.quantidade || 0);
      mapa.set(key, atual);
    });
  });
  return Array.from(mapa.values()).sort((a, b) => (a.descricao || '').localeCompare(b.descricao || ''));
}