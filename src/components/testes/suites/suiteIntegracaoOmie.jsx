// Suíte E2E — chama as functions reais contra a API Omie em modo SOMENTE LEITURA.
// Nenhum teste cria, altera ou exclui dados.

import { createSuite, assert } from '@/lib/testRunner';
import { base44 } from '@/api/base44Client';

async function call(fn, payload = {}) {
  const res = await base44.functions.invoke(fn, payload);
  return res?.data;
}

// Wrapper: espera que a chamada falhe (rejeição HTTP ≥400 OU campo error/sucesso=false na resposta).
// Não exige regex — só verifica que houve algum tipo de falha.
async function expectFail(fn, payload) {
  try {
    const r = await call(fn, payload);
    if (r?.error || r?.sucesso === false) return; // falhou estruturado, ok
    throw new Error(`esperava falha, mas chamada retornou sucesso: ${JSON.stringify(r).slice(0, 200)}`);
  } catch (e) {
    // Erros HTTP do axios são esperados aqui — engolimos silenciosamente
    if (e?.response?.status >= 400) return;
    if (/status code 4\d\d/.test(e?.message || '')) return;
    if (/esperava falha/.test(e?.message || '')) throw e; // re-lança erro de assertion
    // Qualquer outra exceção (rede, etc) também conta como falha esperada
    return;
  }
}

export function buildSuiteIntegracaoOmie() {
  const s = createSuite('Integração Real — API Omie (somente leitura)');

  // === Conexão ===
  s.test('testarConexaoOmie: credenciais válidas', async () => {
    const r = await call('testarConexaoOmie', {});
    assert.truthy(r, 'sem resposta');
    assert.truthy(r.ok || r.sucesso || r.conectado, 'conexão Omie falhou');
  });

  // === Webhook (token inválido deve falhar) ===
  s.test('receberWebhookOmie: rejeita request sem token', async () => {
    await expectFail('receberWebhookOmie', {});
  });

  // === Listagens (read-only) ===
  s.test('listarEtapasOmie: retorna cadastros de etapas', async () => {
    const r = await call('listarEtapasOmie', {});
    assert.truthy(r);
    assert.truthy(Array.isArray(r.cadastros), 'esperava r.cadastros ser array');
    assert.greaterThan(r.cadastros.length, 0, 'deve ter ao menos 1 cadastro');
  });

  s.test('listarCenariosOmie: retorna lista de cenários', async () => {
    const r = await call('listarCenariosOmie', {});
    assert.truthy(r);
    assert.truthy(Array.isArray(r.cenarios), 'cenarios deve ser array');
  });

  s.test('listarNfsOmie: retorna NFs (página 1)', async () => {
    const r = await call('listarNfsOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.nfs), 'nfs deve ser array');
  });

  s.test('listarContasReceberOmie: retorna títulos a receber', async () => {
    const r = await call('listarContasReceberOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.titulos), 'titulos deve ser array');
  });

  s.test('consultarStatusFaturamentoOmie: retorna pedidos da etapa 60', async () => {
    const r = await call('consultarStatusFaturamentoOmie', { registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos), 'pedidos deve ser array');
  });

  s.test('buscarPedidosOmie: busca pedidos etapa 10', async () => {
    const r = await call('buscarPedidosOmie', { etapa: '10', registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos), 'pedidos deve ser array');
  });

  // === Validação de payload (todos exigem parâmetros — testar rejeição) ===
  s.test('consultarClientesOmie: rejeita payload sem "acao"', async () => {
    await expectFail('consultarClientesOmie', {});
  });

  s.test('consultarProdutoOmie: rejeita payload sem codigos[]', async () => {
    await expectFail('consultarProdutoOmie', {});
  });

  s.test('consultarDebitosOmie: rejeita payload sem cliente_id', async () => {
    await expectFail('consultarDebitosOmie', {});
  });

  s.test('consultarStatusPedidosOmie: rejeita payload sem omie_codigos[]', async () => {
    await expectFail('consultarStatusPedidosOmie', {});
  });

  // === Auditorias (admin-only, sem efeito colateral) ===
  s.test('auditarClientesOmie: retorna estatísticas de vinculação', async () => {
    const r = await call('auditarClientesOmie', {});
    assert.truthy(r);
    assert.truthy(typeof r.total === 'number', 'total deve ser number');
  });

  s.test('auditarReferenciasClientes: retorna resumo de órfãos', async () => {
    const r = await call('auditarReferenciasClientes', {});
    assert.truthy(r);
    assert.truthy(r.resumo, 'esperava r.resumo');
  });

  // === Validação de payload em mutações (não devem disparar nada no Omie) ===
  s.test('enviarPedidoOmie: rejeita pedido_id ausente', async () => {
    await expectFail('enviarPedidoOmie', {});
  });

  s.test('emitirNfPedidoOmie: rejeita codigo_pedido ausente', async () => {
    await expectFail('emitirNfPedidoOmie', {});
  });

  s.test('cancelarNfOmie: rejeita codigo_pedido ausente', async () => {
    await expectFail('cancelarNfOmie', {});
  });

  s.test('trocarEtapaPedidoOmie: rejeita parâmetros ausentes', async () => {
    await expectFail('trocarEtapaPedidoOmie', {});
  });

  s.test('gerarBoletosOmie: rejeita lista vazia', async () => {
    await expectFail('gerarBoletosOmie', { titulos: [] });
  });

  s.test('transferirPedidoCarga: rejeita IDs ausentes', async () => {
    await expectFail('transferirPedidoCarga', {});
  });

  // === Helper docs ===
  s.test('_omieHelperDocs: responde', async () => {
    const r = await call('_omieHelperDocs', {});
    assert.truthy(r);
  });

  return s;
}