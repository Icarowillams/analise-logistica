// Suíte E2E — chama as functions reais contra a API Omie em modo SOMENTE LEITURA.
// Nenhum teste cria, altera ou exclui dados.

import { createSuite, assert } from '@/lib/testRunner';
import { base44 } from '@/api/base44Client';

async function call(fn, payload = {}) {
  const res = await base44.functions.invoke(fn, payload);
  return res?.data;
}

// Wrapper: espera que a chamada falhe (rejeição HTTP OU campo error/sucesso=false na resposta)
async function expectFail(fn, payload, regex = null) {
  let lancou = false;
  let mensagem = '';
  try {
    const r = await call(fn, payload);
    // Se não lançou, deve ter retornado erro estruturado
    if (r?.error) { lancou = true; mensagem = String(r.error); }
    else if (r?.sucesso === false) { lancou = true; mensagem = String(r.erro || r.error || ''); }
  } catch (e) {
    lancou = true;
    mensagem = e?.response?.data?.error || e?.message || String(e);
  }
  assert.truthy(lancou, 'esperava falha mas chamada teve sucesso');
  if (regex) assert.match(mensagem, regex, `mensagem de erro não bate: "${mensagem}"`);
}

export function buildSuiteIntegracaoOmie() {
  const s = createSuite('Integração Real — API Omie (somente leitura)');

  // === Conexão ===
  s.test('testarConexaoOmie: credenciais válidas', async () => {
    const r = await call('testarConexaoOmie', {});
    assert.truthy(r, 'sem resposta');
    assert.truthy(r.sucesso || r.ok || r.conectado, 'conexão Omie falhou');
  });

  // === Webhook (token inválido deve falhar) ===
  s.test('receberWebhookOmie: rejeita request sem token', async () => {
    await expectFail('receberWebhookOmie', {}, /token|unauthorized|401|403/i);
  });

  // === Listagens (read-only) ===
  s.test('listarEtapasOmie: retorna cadastros de etapas', async () => {
    const r = await call('listarEtapasOmie', {});
    assert.truthy(r);
    // Função devolve resposta crua do Omie: { cadastros: [...] }
    assert.truthy(Array.isArray(r.cadastros), 'esperava r.cadastros ser array');
    assert.greaterThan(r.cadastros.length, 0, 'deve ter ao menos 1 cadastro');
  });

  s.test('listarCenariosOmie: retorna lista de cenários', async () => {
    const r = await call('listarCenariosOmie', {});
    assert.truthy(r);
    assert.equal(r.sucesso, true);
    assert.truthy(Array.isArray(r.cenarios), 'cenarios deve ser array');
  });

  s.test('listarNfsOmie: retorna NFs (página 1)', async () => {
    const r = await call('listarNfsOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
    assert.equal(r.sucesso, true);
    assert.truthy(Array.isArray(r.nfs), 'nfs deve ser array');
  });

  s.test('listarContasReceberOmie: retorna títulos a receber', async () => {
    const r = await call('listarContasReceberOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
    assert.equal(r.sucesso, true);
    assert.truthy(Array.isArray(r.titulos), 'titulos deve ser array');
  });

  s.test('consultarStatusFaturamentoOmie: retorna pedidos da etapa 60', async () => {
    const r = await call('consultarStatusFaturamentoOmie', { registros_por_pagina: 5 });
    assert.truthy(r);
    assert.equal(r.sucesso, true);
    assert.truthy(Array.isArray(r.pedidos), 'pedidos deve ser array');
  });

  s.test('buscarPedidosOmie: busca pedidos etapa 10', async () => {
    const r = await call('buscarPedidosOmie', { etapa: '10', registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos), 'pedidos deve ser array');
  });

  // === Validação de payload (todos exigem parâmetros — testar rejeição) ===
  s.test('consultarClientesOmie: exige parâmetro "acao"', async () => {
    await expectFail('consultarClientesOmie', {}, /acao|inv[áa]lid|listar_omie|comparar/i);
  });

  s.test('consultarProdutoOmie: exige codigos[]', async () => {
    await expectFail('consultarProdutoOmie', {}, /codigos|obrig|400/i);
  });

  s.test('consultarDebitosOmie: exige cliente_id', async () => {
    await expectFail('consultarDebitosOmie', {}, /cliente_id|obrig|400/i);
  });

  s.test('consultarStatusPedidosOmie: exige omie_codigos[]', async () => {
    await expectFail('consultarStatusPedidosOmie', {}, /omie_codigos|obrig|array|400/i);
  });

  // === Auditorias (admin-only, sem efeito colateral) ===
  s.test('auditarClientesOmie: retorna estatísticas de vinculação', async () => {
    const r = await call('auditarClientesOmie', {});
    assert.truthy(r);
    assert.truthy(typeof r.total === 'number', 'total deve ser number');
    assert.truthy(typeof r.vinculados_omie === 'number');
  });

  s.test('auditarReferenciasClientes: retorna resumo de órfãos', async () => {
    const r = await call('auditarReferenciasClientes', {});
    assert.truthy(r);
    assert.equal(r.sucesso, true);
    assert.truthy(r.resumo, 'esperava r.resumo');
  });

  // === Validação de payload em mutações (não devem disparar nada no Omie) ===
  s.test('enviarPedidoOmie: rejeita pedido_id ausente ou inexistente', async () => {
    await expectFail('enviarPedidoOmie', {}, /pedido_id|n[ãa]o encontrad|obrig|400|404/i);
  });

  s.test('emitirNfPedidoOmie: rejeita codigo_pedido ausente', async () => {
    await expectFail('emitirNfPedidoOmie', {}, /codigo_pedido|obrig|400/i);
  });

  s.test('cancelarNfOmie: rejeita codigo_pedido ausente', async () => {
    await expectFail('cancelarNfOmie', {}, /codigo_pedido|obrig|400/i);
  });

  s.test('trocarEtapaPedidoOmie: rejeita parâmetros ausentes', async () => {
    await expectFail('trocarEtapaPedidoOmie', {}, /etapa|codigo|obrig|400/i);
  });

  s.test('gerarBoletosOmie: rejeita lista vazia', async () => {
    await expectFail('gerarBoletosOmie', { titulos: [] }, /vazio|titulos|obrig|400/i);
  });

  s.test('transferirPedidoCarga: rejeita IDs ausentes', async () => {
    await expectFail('transferirPedidoCarga', {}, /obrig|carga|pedido|400/i);
  });

  // === Helper docs ===
  s.test('_omieHelperDocs: responde', async () => {
    const r = await call('_omieHelperDocs', {});
    assert.truthy(r);
  });

  return s;
}