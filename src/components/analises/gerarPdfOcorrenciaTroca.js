import { jsPDF } from 'jspdf';

function formatDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function gerarPdfOcorrenciaTroca({ filtradas, itensPorPedido, filtros, vendedores }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const margin = 12;
  const pageW = 297;
  const pageH = 210;
  const lineH = 5.5;
  let y = margin;

  const fmtMoeda = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const dataRelatorio = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  const vendedorNome = filtros?.vendedor_id ? (vendedores?.find(v => v.id === filtros.vendedor_id)?.nome || '') : '';
  const periodo = (filtros?.inicio || filtros?.fim)
    ? `${filtros.inicio ? formatDateBR(filtros.inicio) : '...'} a ${filtros.fim ? formatDateBR(filtros.fim) : '...'}`
    : '—';

  // ── Agrupar por produto → motivo ──
  const porProduto = new Map();
  filtradas.forEach(t => {
    const itens = itensPorPedido.get(t.id) || [];
    itens.forEach(it => {
      const cod = it.produto_codigo || '(sem código)';
      const nome = it.produto_nome || cod || '(sem nome)';
      const motivo = it.motivo_troca_descricao || 'Sem motivo';
      const qtd = Number(it.quantidade || 0);
      const valor = Number(it.valor_total) > 0
        ? Number(it.valor_total)
        : Number((Number(it.valor_unitario || 0)) * qtd);
      const chave = cod + '||' + nome;
      let p = porProduto.get(chave);
      if (!p) { p = { codigo: cod, nome, qtd: 0, valor: 0, motivos: new Map() }; porProduto.set(chave, p); }
      p.qtd += qtd;
      p.valor += valor;
      let m = p.motivos.get(motivo);
      if (!m) { m = { motivo, qtd: 0, valor: 0 }; p.motivos.set(motivo, m); }
      m.qtd += qtd;
      m.valor += valor;
    });
  });

  const produtos = [...porProduto.values()].map(p => ({
    ...p,
    motivos: [...p.motivos.values()].sort((a, b) => b.valor - a.valor)
  })).sort((a, b) => b.valor - a.valor);

  // Posições de coluna
  const colEmp = margin;
  const colCod = margin + 14;
  const colProd = margin + 42;
  const rightQtde = margin + 195;
  const rightValor = margin + 260;

  // ── Cabeçalho do relatório ──
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Ocorrência de Troca por Pedido', margin, y + 5);
  y += 11;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Empresa: PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME', margin, y); y += 5;
  doc.text('Cliente:', margin, y);
  doc.text(`Vendedor: ${vendedorNome || '—'}`, margin + 100, y); y += 5;
  doc.text('Nº Pedido / Manifesto / Carga: 0', margin, y); y += 5;
  doc.text(`Período de Lançamento: ${periodo}`, margin, y); y += 5;
  doc.text(`Data do Relatório: ${dataRelatorio}`, margin, y); y += 8;

  // Cabeçalho de colunas reutilizável (para repetir no topo de cada página)
  const drawColHeader = () => {
    doc.setFillColor(230, 230, 230);
    doc.rect(margin, y - 4, pageW - 2 * margin, lineH, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Emp', colEmp, y);
    doc.text('Cód', colCod, y);
    doc.text('Produto', colProd, y);
    doc.text('Qtde', rightQtde, y, { align: 'right' });
    doc.text('Valor', rightValor, y, { align: 'right' });
    y += lineH + 1;
  };

  drawColHeader();

  let totalQtdGeral = 0;
  let totalValorGeral = 0;

  produtos.forEach(p => {
    // Altura do bloco inteiro: 1 linha produto + N linhas motivo + 1 respiro
    const blockH = (1 + p.motivos.length) * lineH + 1;
    // Se NÃO couber, quebra ANTES de começar o produto (nunca corta o bloco)
    if (y + blockH > pageH - margin - 10) {
      doc.addPage();
      y = margin;
      drawColHeader();
    }

    // Linha do produto
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y - 4, pageW - 2 * margin, lineH, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('01', colEmp, y);
    doc.text(String(p.codigo).slice(0, 12), colCod, y);
    doc.text(String(p.nome).slice(0, 60), colProd, y);
    doc.text(fmtNum(p.qtd), rightQtde, y, { align: 'right' });
    doc.text(fmtMoeda(p.valor), rightValor, y, { align: 'right' });
    y += lineH;
    totalQtdGeral += p.qtd;
    totalValorGeral += p.valor;

    // Sub-bloco Ocorrência (por motivo)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    p.motivos.forEach(m => {
      doc.text(String(m.motivo).slice(0, 50), colProd + 5, y);
      doc.text(fmtNum(m.qtd), rightQtde, y, { align: 'right' });
      doc.text(fmtMoeda(m.valor), rightValor, y, { align: 'right' });
      y += lineH;
    });
    y += 1;
  });

  // Total geral
  if (y + lineH > pageH - margin) {
    doc.addPage();
    y = margin;
  }
  doc.setFillColor(220, 220, 220);
  doc.rect(margin, y - 4, pageW - 2 * margin, lineH, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL GERAL', colProd, y);
  doc.text(fmtNum(totalQtdGeral), rightQtde, y, { align: 'right' });
  doc.text(fmtMoeda(totalValorGeral), rightValor, y, { align: 'right' });

  doc.save(`ocorrencia_troca_por_pedido_${new Date().toISOString().slice(0, 10)}.pdf`);

  return {
    produtos: produtos.length,
    ocorrencias: produtos.reduce((a, p) => a + p.motivos.length, 0)
  };
}