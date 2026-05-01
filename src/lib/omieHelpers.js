// Helpers puros extraídos das functions backend — espelhados aqui para serem testáveis no frontend.
// IMPORTANTE: se alterar uma função aqui, alterar também na function correspondente.

// === enviarClienteOmie ===
export const estadoParaUF = {
  'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
  'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES',
  'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
  'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
  'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
};

export function normalizarEstado(estado) {
  let normalizado = (estado || '').trim();
  if (normalizado.length > 2) {
    const chave = normalizado.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    normalizado = estadoParaUF[chave] || normalizado.substring(0, 2).toUpperCase();
  } else {
    normalizado = normalizado.toUpperCase();
  }
  return normalizado;
}

export function normalizarCEP(cep) {
  const limpo = (cep || '').replace(/\D/g, '');
  return limpo.substring(0, 8);
}

export function normalizarCpfCnpj(doc) {
  return (doc || '').replace(/[.\-\/\s]/g, '');
}

export function validarCPF(cpf) {
  cpf = (cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== parseInt(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === parseInt(cpf[10]);
}

export function validarCNPJ(cnpj) {
  cnpj = (cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base, pesos) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += parseInt(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const dv1 = calc(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== parseInt(cnpj[12])) return false;
  const dv2 = calc(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === parseInt(cnpj[13]);
}

export function validarCpfCnpj(doc) {
  const limpo = (doc || '').replace(/\D/g, '');
  if (limpo.length === 11) return validarCPF(limpo);
  if (limpo.length === 14) return validarCNPJ(limpo);
  return false;
}

export function removerAspas(val) {
  if (typeof val !== 'string') return val;
  let v = val.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

// === enviarPedidoOmie ===
export function formatDateOmie(dateStr) {
  if (!dateStr) {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    return `${d}/${m}/${y}`;
  }
  if (dateStr.includes('-')) {
    const [y, m, d] = dateStr.split('T')[0].split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

export function gerarParcelas(plano, valorTotal, dataBase) {
  const numParcelas = plano?.numero_parcelas || 1;
  const diasPrimeira = plano?.dias_primeira_parcela || 30;
  const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;

  const parcelas = [];
  for (let i = 0; i < numParcelas; i++) {
    const diasOffset = diasPrimeira + (i * 30);
    const dataVenc = new Date(dataBase);
    dataVenc.setDate(dataVenc.getDate() + diasOffset);

    const d = String(dataVenc.getDate()).padStart(2, '0');
    const m = String(dataVenc.getMonth() + 1).padStart(2, '0');
    const y = dataVenc.getFullYear();

    let valor = valorParcela;
    if (i === numParcelas - 1) {
      const totalAnterior = parcelas.reduce((s, p) => s + p.valor, 0);
      valor = Math.round((valorTotal - totalAnterior) * 100) / 100;
    }

    parcelas.push({
      numero_parcela: i + 1,
      data_vencimento: `${d}/${m}/${y}`,
      percentual: Math.round((100 / numParcelas) * 100) / 100,
      valor
    });
  }
  return parcelas;
}

// === Cálculo de preço (PedidoFormulario) ===
// Prioridade: AcaoPromocional ativa > PrecoProduto.valor_acao vigente > PrecoProduto.valor_unitario
export function calcularPrecoProduto({ produto_id, cliente_id, tabela_id, hoje, acoes = [], precos = [] }) {
  const hojeStr = hoje || new Date().toISOString().slice(0, 10);

  // 1. AcaoPromocional ativa para o produto + cliente + tabela
  const acaoAtiva = acoes.find(a => {
    if (a.status !== 'ativa') return false;
    if (a.produto_id !== produto_id) return false;
    if (a.data_inicio && a.data_inicio > hojeStr) return false;
    if (a.data_fim && a.data_fim < hojeStr) return false;
    if (a.tabela_id && a.tabela_id !== tabela_id) return false;
    if (a.clientes_ids && a.clientes_ids.length > 0 && !a.clientes_ids.includes(cliente_id)) return false;
    return true;
  });
  if (acaoAtiva) return { valor: acaoAtiva.valor_acao, origem: 'acao_promocional' };

  // 2. PrecoProduto.valor_acao vigente
  const preco = precos.find(p => p.produto_id === produto_id && p.tabela_id === tabela_id);
  if (preco) {
    if (preco.ativacao_acao && preco.valor_acao && preco.periodo_acao_fim && preco.periodo_acao_fim >= hojeStr) {
      return { valor: preco.valor_acao, origem: 'preco_acao' };
    }
    if (preco.valor_unitario) return { valor: preco.valor_unitario, origem: 'preco_base' };
  }

  return { valor: 0, origem: 'sem_preco' };
}

// === Bloqueio financeiro ===
export function avaliarBloqueio({ titulosOmie = [], limiteCredito = 0, saldoUtilizado = 0 }) {
  const atrasados = titulosOmie.filter(t => t.status_titulo === 'ATRASADO').length;
  const limiteEstourado = limiteCredito > 0 && saldoUtilizado > limiteCredito;
  return { bloqueado: atrasados > 0 || limiteEstourado, atrasados, limiteEstourado };
}