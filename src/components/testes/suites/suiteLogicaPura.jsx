import { createSuite, assert } from '@/lib/testRunner';
import {
  validarCPF,
  validarCNPJ,
  validarCpfCnpj,
  normalizarEstado,
  normalizarCEP,
  normalizarCpfCnpj,
  removerAspas,
  formatDateOmie,
  gerarParcelas,
  calcularPrecoProduto,
  avaliarBloqueio
} from '@/lib/omieHelpers';

export function buildSuiteLogicaPura() {
  const s = createSuite('Lógica Pura — Helpers Omie');

  // === CPF ===
  s.test('validarCPF: aceita CPF válido (11144477735)', () => {
    assert.equal(validarCPF('111.444.777-35'), true);
  });
  s.test('validarCPF: rejeita CPF inválido (12345678900)', () => {
    assert.equal(validarCPF('123.456.789-00'), false);
  });
  s.test('validarCPF: rejeita 11 dígitos iguais (11111111111)', () => {
    assert.equal(validarCPF('111.111.111-11'), false);
  });
  s.test('validarCPF: rejeita string vazia', () => {
    assert.equal(validarCPF(''), false);
  });
  s.test('validarCPF: rejeita undefined', () => {
    assert.equal(validarCPF(undefined), false);
  });
  s.test('validarCPF: rejeita CPF com menos de 11 dígitos', () => {
    assert.equal(validarCPF('123'), false);
  });

  // === CNPJ ===
  s.test('validarCNPJ: aceita CNPJ válido (11.222.333/0001-81)', () => {
    assert.equal(validarCNPJ('11.222.333/0001-81'), true);
  });
  s.test('validarCNPJ: rejeita CNPJ inválido', () => {
    assert.equal(validarCNPJ('11.222.333/0001-00'), false);
  });
  s.test('validarCNPJ: rejeita 14 dígitos iguais', () => {
    assert.equal(validarCNPJ('11.111.111/1111-11'), false);
  });
  s.test('validarCNPJ: rejeita string vazia', () => {
    assert.equal(validarCNPJ(''), false);
  });

  // === validarCpfCnpj (router) ===
  s.test('validarCpfCnpj: roteia para CPF (11 dígitos)', () => {
    assert.equal(validarCpfCnpj('111.444.777-35'), true);
  });
  s.test('validarCpfCnpj: roteia para CNPJ (14 dígitos)', () => {
    assert.equal(validarCpfCnpj('11.222.333/0001-81'), true);
  });
  s.test('validarCpfCnpj: rejeita comprimento inválido (10 dígitos)', () => {
    assert.equal(validarCpfCnpj('1234567890'), false);
  });

  // === Normalização Estado ===
  s.test('normalizarEstado: converte "São Paulo" → SP', () => {
    assert.equal(normalizarEstado('São Paulo'), 'SP');
  });
  s.test('normalizarEstado: converte "rio grande do sul" → RS', () => {
    assert.equal(normalizarEstado('rio grande do sul'), 'RS');
  });
  s.test('normalizarEstado: mantém UF já em sigla (SP)', () => {
    assert.equal(normalizarEstado('SP'), 'SP');
  });
  s.test('normalizarEstado: força uppercase em sigla minúscula', () => {
    assert.equal(normalizarEstado('sp'), 'SP');
  });
  s.test('normalizarEstado: lida com vazio', () => {
    assert.equal(normalizarEstado(''), '');
  });

  // === Normalização CEP ===
  s.test('normalizarCEP: limpa caracteres não-dígito', () => {
    assert.equal(normalizarCEP('60.123-456'), '60123456');
  });
  s.test('normalizarCEP: trunca em 8 dígitos', () => {
    assert.equal(normalizarCEP('123456789012'), '12345678');
  });
  s.test('normalizarCEP: lida com null', () => {
    assert.equal(normalizarCEP(null), '');
  });

  // === Normalização CPF/CNPJ ===
  s.test('normalizarCpfCnpj: remove pontos, traços e barras', () => {
    assert.equal(normalizarCpfCnpj('11.222.333/0001-81'), '11222333000181');
  });
  s.test('normalizarCpfCnpj: lida com undefined', () => {
    assert.equal(normalizarCpfCnpj(undefined), '');
  });

  // === Remover Aspas ===
  s.test('removerAspas: remove aspas duplas', () => {
    assert.equal(removerAspas('"texto"'), 'texto');
  });
  s.test('removerAspas: remove aspas simples', () => {
    assert.equal(removerAspas("'texto'"), 'texto');
  });
  s.test('removerAspas: mantém texto sem aspas', () => {
    assert.equal(removerAspas('texto'), 'texto');
  });
  s.test('removerAspas: mantém aspas internas', () => {
    assert.equal(removerAspas('a"b'), 'a"b');
  });
  s.test('removerAspas: passa-through em não-string', () => {
    assert.equal(removerAspas(123), 123);
  });

  // === Format Date Omie ===
  s.test('formatDateOmie: converte ISO YYYY-MM-DD → DD/MM/YYYY', () => {
    assert.equal(formatDateOmie('2026-05-01'), '01/05/2026');
  });
  s.test('formatDateOmie: converte ISO completo com T → DD/MM/YYYY', () => {
    assert.equal(formatDateOmie('2026-12-31T15:30:00.000Z'), '31/12/2026');
  });
  s.test('formatDateOmie: mantém formato brasileiro', () => {
    assert.equal(formatDateOmie('15/03/2026'), '15/03/2026');
  });
  s.test('formatDateOmie: gera data atual quando vazio', () => {
    const r = formatDateOmie('');
    assert.match(r, /^\d{2}\/\d{2}\/\d{4}$/);
  });

  // === Gerar Parcelas ===
  s.test('gerarParcelas: 1 parcela, valor inteiro', () => {
    const p = gerarParcelas({ numero_parcelas: 1, dias_primeira_parcela: 30 }, 100, new Date('2026-01-01T12:00:00'));
    assert.equal(p.length, 1);
    assert.equal(p[0].valor, 100);
    assert.equal(p[0].numero_parcela, 1);
  });
  s.test('gerarParcelas: 3 parcelas, soma exata sem perda de centavos', () => {
    const p = gerarParcelas({ numero_parcelas: 3, dias_primeira_parcela: 30 }, 100, new Date('2026-01-01T12:00:00'));
    assert.equal(p.length, 3);
    const soma = p.reduce((s, x) => s + x.valor, 0);
    assert.equal(Math.round(soma * 100) / 100, 100);
  });
  s.test('gerarParcelas: padrão 1x quando plano vazio', () => {
    const p = gerarParcelas(null, 50, new Date('2026-01-01T12:00:00'));
    assert.equal(p.length, 1);
    assert.equal(p[0].valor, 50);
  });
  s.test('gerarParcelas: data formatada DD/MM/YYYY', () => {
    const p = gerarParcelas({ numero_parcelas: 1, dias_primeira_parcela: 30 }, 100, new Date('2026-01-01T12:00:00'));
    assert.match(p[0].data_vencimento, /^\d{2}\/\d{2}\/\d{4}$/);
  });

  // === Cálculo de Preço (REGRA CRÍTICA) ===
  s.test('calcularPrecoProduto: prioridade 1 — AcaoPromocional ativa', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'c1', tabela_id: 't1', hoje: '2026-05-01',
      acoes: [{ produto_id: 'p1', tabela_id: 't1', clientes_ids: ['c1'], status: 'ativa', data_inicio: '2026-01-01', data_fim: '2026-12-31', valor_acao: 5 }],
      precos: [{ produto_id: 'p1', tabela_id: 't1', valor_unitario: 10, valor_acao: 8, ativacao_acao: true, periodo_acao_fim: '2026-12-31' }]
    });
    assert.equal(r.valor, 5);
    assert.equal(r.origem, 'acao_promocional');
  });
  s.test('calcularPrecoProduto: AcaoPromocional ignorada se cliente fora da lista', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'c2', tabela_id: 't1', hoje: '2026-05-01',
      acoes: [{ produto_id: 'p1', tabela_id: 't1', clientes_ids: ['c1'], status: 'ativa', data_inicio: '2026-01-01', data_fim: '2026-12-31', valor_acao: 5 }],
      precos: [{ produto_id: 'p1', tabela_id: 't1', valor_unitario: 10, valor_acao: 8, ativacao_acao: true, periodo_acao_fim: '2026-12-31' }]
    });
    assert.equal(r.valor, 8);
    assert.equal(r.origem, 'preco_acao');
  });
  s.test('calcularPrecoProduto: AcaoPromocional ignorada se tabela diferente', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'c1', tabela_id: 't2', hoje: '2026-05-01',
      acoes: [{ produto_id: 'p1', tabela_id: 't1', status: 'ativa', data_inicio: '2026-01-01', data_fim: '2026-12-31', valor_acao: 5 }],
      precos: [{ produto_id: 'p1', tabela_id: 't2', valor_unitario: 10 }]
    });
    assert.equal(r.valor, 10);
    assert.equal(r.origem, 'preco_base');
  });
  s.test('calcularPrecoProduto: prioridade 2 — valor_acao vigente', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'c1', tabela_id: 't1', hoje: '2026-05-01',
      acoes: [],
      precos: [{ produto_id: 'p1', tabela_id: 't1', valor_unitario: 10, valor_acao: 7, ativacao_acao: true, periodo_acao_fim: '2026-12-31' }]
    });
    assert.equal(r.valor, 7);
    assert.equal(r.origem, 'preco_acao');
  });
  s.test('calcularPrecoProduto: valor_acao vencido cai pra valor_unitario', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'c1', tabela_id: 't1', hoje: '2026-05-01',
      acoes: [],
      precos: [{ produto_id: 'p1', tabela_id: 't1', valor_unitario: 10, valor_acao: 7, ativacao_acao: true, periodo_acao_fim: '2026-01-01' }]
    });
    assert.equal(r.valor, 10);
    assert.equal(r.origem, 'preco_base');
  });
  s.test('calcularPrecoProduto: ativacao_acao=false ignora valor_acao', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'c1', tabela_id: 't1', hoje: '2026-05-01',
      acoes: [],
      precos: [{ produto_id: 'p1', tabela_id: 't1', valor_unitario: 10, valor_acao: 7, ativacao_acao: false, periodo_acao_fim: '2026-12-31' }]
    });
    assert.equal(r.valor, 10);
    assert.equal(r.origem, 'preco_base');
  });
  s.test('calcularPrecoProduto: sem preço retorna 0', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'c1', tabela_id: 't1', hoje: '2026-05-01',
      acoes: [], precos: []
    });
    assert.equal(r.valor, 0);
    assert.equal(r.origem, 'sem_preco');
  });

  // === Bloqueio Financeiro ===
  s.test('avaliarBloqueio: sem atrasos e sem limite estourado → liberado', () => {
    const r = avaliarBloqueio({ titulosOmie: [{ status_titulo: 'ABERTO' }], limiteCredito: 1000, saldoUtilizado: 500 });
    assert.equal(r.bloqueado, false);
  });
  s.test('avaliarBloqueio: 1 título ATRASADO → bloqueia', () => {
    const r = avaliarBloqueio({ titulosOmie: [{ status_titulo: 'ATRASADO' }] });
    assert.equal(r.bloqueado, true);
    assert.equal(r.atrasados, 1);
  });
  s.test('avaliarBloqueio: limite estourado → bloqueia', () => {
    const r = avaliarBloqueio({ titulosOmie: [], limiteCredito: 1000, saldoUtilizado: 1500 });
    assert.equal(r.bloqueado, true);
    assert.equal(r.limiteEstourado, true);
  });
  s.test('avaliarBloqueio: sem limite definido (0) não bloqueia por crédito', () => {
    const r = avaliarBloqueio({ titulosOmie: [], limiteCredito: 0, saldoUtilizado: 99999 });
    assert.equal(r.bloqueado, false);
  });

  return s;
}