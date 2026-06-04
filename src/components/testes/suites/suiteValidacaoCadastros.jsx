// Suíte: validações de cadastro do dia-a-dia — o que o usuário digita errado e o sistema deve barrar.

import { createSuite, assert } from '@/lib/testRunner';
import {
  validarCPF, validarCNPJ, validarCpfCnpj,
  normalizarEstado, normalizarCEP, normalizarCpfCnpj,
  truncarOmie, removerAspas, formatDateOmie, saudacaoPorHorario
} from '@/lib/omieHelpers';

export function buildSuiteValidacaoCadastros() {
  const s = createSuite('Validações de Cadastro (entrada do usuário)');

  // ============================================================
  // CPF — pegadinhas reais
  // ============================================================
  s.test('CPF: rejeita "00000000000"', () => assert.equal(validarCPF('00000000000'), false));
  s.test('CPF: rejeita "99999999999"', () => assert.equal(validarCPF('99999999999'), false));
  s.test('CPF: aceita formatado com pontos e traço', () => assert.equal(validarCPF('111.444.777-35'), true));
  s.test('CPF: aceita só números', () => assert.equal(validarCPF('11144477735'), true));
  s.test('CPF: rejeita com letras', () => assert.equal(validarCPF('111.444.777-AB'), false));
  s.test('CPF: rejeita com 12 dígitos', () => assert.equal(validarCPF('111444777355'), false));

  // ============================================================
  // CNPJ — pegadinhas reais
  // ============================================================
  s.test('CNPJ: rejeita "00000000000000"', () => assert.equal(validarCNPJ('00000000000000'), false));
  s.test('CNPJ: aceita CNPJ real válido', () => assert.equal(validarCNPJ('11.222.333/0001-81'), true));
  s.test('CNPJ: aceita só números', () => assert.equal(validarCNPJ('11222333000181'), true));
  s.test('CNPJ: rejeita com 13 dígitos', () => assert.equal(validarCNPJ('1122233300018'), false));
  s.test('CNPJ: rejeita com 15 dígitos', () => assert.equal(validarCNPJ('112223330001810'), false));

  // ============================================================
  // Roteador CPF/CNPJ
  // ============================================================
  s.test('CPF/CNPJ: 11 dígitos roteia para CPF', () => assert.equal(validarCpfCnpj('11144477735'), true));
  s.test('CPF/CNPJ: 14 dígitos roteia para CNPJ', () => assert.equal(validarCpfCnpj('11222333000181'), true));
  s.test('CPF/CNPJ: 12 dígitos rejeita', () => assert.equal(validarCpfCnpj('111444777355'), false));
  s.test('CPF/CNPJ: vazio rejeita', () => assert.equal(validarCpfCnpj(''), false));
  s.test('CPF/CNPJ: null rejeita', () => assert.equal(validarCpfCnpj(null), false));

  // ============================================================
  // Estado / UF
  // ============================================================
  s.test('UF: "São Paulo" → SP', () => assert.equal(normalizarEstado('São Paulo'), 'SP'));
  s.test('UF: "Ceará" → CE', () => assert.equal(normalizarEstado('Ceará'), 'CE'));
  s.test('UF: "RIO GRANDE DO SUL" → RS', () => assert.equal(normalizarEstado('RIO GRANDE DO SUL'), 'RS'));
  s.test('UF: "espirito santo" sem acento → ES', () => assert.equal(normalizarEstado('espirito santo'), 'ES'));
  s.test('UF: "df" → DF', () => assert.equal(normalizarEstado('df'), 'DF'));
  s.test('UF: estado desconhecido pega 2 primeiras letras maiúsculas', () => {
    assert.equal(normalizarEstado('Atlantis'), 'AT');
  });

  // ============================================================
  // CEP
  // ============================================================
  s.test('CEP: aceita formato 00000-000', () => assert.equal(normalizarCEP('60123-456'), '60123456'));
  s.test('CEP: aceita com pontos', () => assert.equal(normalizarCEP('60.123-456'), '60123456'));
  s.test('CEP: trunca em 8', () => assert.equal(normalizarCEP('601234567890'), '60123456'));
  s.test('CEP: vazio retorna ""', () => assert.equal(normalizarCEP(''), ''));

  // ============================================================
  // Limpeza de strings (Omie é chato com encoding)
  // ============================================================
  s.test('Aspas: remove aspas duplas externas', () => assert.equal(removerAspas('"Pão & Mel"'), 'Pão & Mel'));
  s.test('Aspas: remove aspas simples externas', () => assert.equal(removerAspas("'Pão'"), 'Pão'));
  s.test('Aspas: NÃO remove aspas internas', () => assert.equal(removerAspas('Padaria "Pão" Mel'), 'Padaria "Pão" Mel'));
  s.test('Aspas: lida com texto sem aspas', () => assert.equal(removerAspas('Pão Mel'), 'Pão Mel'));
  s.test('Aspas: não-string passa-through', () => assert.equal(removerAspas(42), 42));

  // ============================================================
  // Truncamento (Omie tem limites de campos)
  // ============================================================
  s.test('Truncar: razão social Omie máx 60', () => {
    const longa = 'A'.repeat(100);
    assert.equal(truncarOmie(longa, 60).length, 60);
  });
  s.test('Truncar: nome fantasia máx 100', () => {
    const longa = 'B'.repeat(150);
    assert.equal(truncarOmie(longa, 100).length, 100);
  });
  s.test('Truncar: descrição produto máx 120', () => {
    const longa = 'C'.repeat(200);
    assert.equal(truncarOmie(longa, 120).length, 120);
  });
  s.test('Truncar: texto curto não é alterado', () => {
    assert.equal(truncarOmie('curto', 60), 'curto');
  });
  s.test('Truncar: vazio retorna ""', () => {
    assert.equal(truncarOmie('', 60), '');
  });

  // ============================================================
  // Formatação de data (Omie só aceita dd/mm/yyyy)
  // ============================================================
  s.test('Data: ISO simples 2026-05-01 → 01/05/2026', () => {
    assert.equal(formatDateOmie('2026-05-01'), '01/05/2026');
  });
  s.test('Data: ISO com hora → ignora hora', () => {
    assert.equal(formatDateOmie('2026-12-31T23:59:59.999Z'), '31/12/2026');
  });
  s.test('Data: dd/mm/yyyy passa direto', () => {
    assert.equal(formatDateOmie('15/08/2026'), '15/08/2026');
  });
  s.test('Data: vazio gera data atual', () => {
    assert.match(formatDateOmie(''), /^\d{2}\/\d{2}\/\d{4}$/);
  });

  // ============================================================
  // CPF/CNPJ — normalização
  // ============================================================
  s.test('Normaliza CPF: remove pontuação', () => {
    assert.equal(normalizarCpfCnpj('111.444.777-35'), '11144477735');
  });
  s.test('Normaliza CNPJ: remove pontuação', () => {
    assert.equal(normalizarCpfCnpj('11.222.333/0001-81'), '11222333000181');
  });
  s.test('Normaliza: undefined → ""', () => {
    assert.equal(normalizarCpfCnpj(undefined), '');
  });

  // ============================================================
  // UX: Saudação por horário
  // ============================================================
  s.test('Saudação 8h: Bom dia', () => assert.equal(saudacaoPorHorario(8), 'Bom dia'));
  s.test('Saudação 12h: Boa tarde', () => assert.equal(saudacaoPorHorario(12), 'Boa tarde'));
  s.test('Saudação 18h: Boa noite', () => assert.equal(saudacaoPorHorario(18), 'Boa noite'));
  s.test('Saudação 23h: Boa noite', () => assert.equal(saudacaoPorHorario(23), 'Boa noite'));

  return s;
}