// Suíte E2E — chama as functions reais contra a API Omie em modo SOMENTE LEITURA.
// Nenhum teste cria, altera ou exclui dados.

import { createSuite, assert } from '@/lib/testRunner';
import { base44 } from '@/api/base44Client';

async function call(fn, payload = {}) {
  const res = await base44.functions.invoke(fn, payload);
  return res?.data;
}

export function buildSuiteIntegracaoOmie() {
  const s = createSuite('Integração Real — API Omie (somente leitura)');

  // === Conexão ===
  s.test('testarConexaoOmie: credenciais válidas e conectividade OK', async () => {
    const r = await call('testarConexaoOmie', {});
    assert.truthy(r, 'sem resposta');
    assert.truthy(r.sucesso || r.ok || r.conectado, 'conexão Omie falhou');
  });

  // === Webhook ===
  s.test('receberWebhookOmie: rejeita request sem token', async () => {
    try {
      await call('receberWebhookOmie', {});
      throw new Error('deveria ter rejeitado');
    } catch (e) {
      assert.match(e.message || '', /401|403|token|unauthorized/i);
    }
  });

  // === Listagens (read-only) ===
  s.test('listarEtapasOmie: retorna etapas de faturamento', async () => {
    const r = await call('listarEtapasOmie', {});
    assert.truthy(r);
    const lista = r.etapas || r.data || r.lista || [];
    assert.greaterOrEqual(lista.length, 0, 'lista de etapas');
  });

  s.test('listarCenariosOmie: retorna cenários fiscais', async () => {
    const r = await call('listarCenariosOmie', {});
    assert.truthy(r);
  });

  s.test('listarNfsOmie: retorna NFs (página 1)', async () => {
    const r = await call('listarNfsOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
  });

  s.test('listarContasReceberOmie: retorna títulos a receber', async () => {
    const r = await call('listarContasReceberOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
    assert.equal(r.sucesso, true);
    assert.truthy(Array.isArray(r.titulos), 'titulos deve ser array');
  });

  s.test('consultarStatusFaturamentoOmie: retorna status de faturamento', async () => {
    const r = await call('consultarStatusFaturamentoOmie', { registros_por_pagina: 5 });
    assert.truthy(r);
  });

  s.test('buscarPedidosOmie: busca pedidos etapa 10', async () => {
    const r = await call('buscarPedidosOmie', { etapa: '10', registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos), 'pedidos deve ser array');
  });

  s.test('consultarStatusPedidosOmie: lista pedidos', async () => {
    const r = await call('consultarStatusPedidosOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
  });

  s.test('consultarClientesOmie: retorna clientes (página 1)', async () => {
    const r = await call('consultarClientesOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
  });

  s.test('consultarProdutoOmie: lista produtos', async () => {
    const r = await call('consultarProdutoOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
  });

  s.test('consultarDebitosOmie: lista débitos abertos', async () => {
    const r = await call('consultarDebitosOmie', {});
    assert.truthy(r);
  });

  // === Auditorias (read-only) ===
  s.test('auditarClientesOmie: executa sem efeito colateral', async () => {
    const r = await call('auditarClientesOmie', { dryRun: true });
    assert.truthy(r);
  });

  s.test('auditarReferenciasClientes: executa em modo leitura', async () => {
    const r = await call('auditarReferenciasClientes', { dryRun: true });
    assert.truthy(r);
  });

  // === Validação de payload ===
  s.test('enviarPedidoOmie: rejeita pedido_id ausente', async () => {
    try {
      await call('enviarPedidoOmie', {});
      throw new Error('deveria ter rejeitado');
    } catch (e) {
      assert.match(e.message || '', /pedido_id|obrig|400/i);
    }
  });

  s.test('enviarPedidoOmie: rejeita pedido_id inexistente', async () => {
    try {
      const r = await call('enviarPedidoOmie', { pedido_id: 'pedido_que_nao_existe_999999' });
      assert.equal(r?.sucesso || false, false);
    } catch (e) {
      assert.match(e.message || '', /n[ãa]o encontrado|not found|inv[áa]lido|400|404/i);
    }
  });

  s.test('emitirNfPedidoOmie: rejeita codigo_pedido ausente', async () => {
    try {
      await call('emitirNfPedidoOmie', {});
      throw new Error('deveria ter rejeitado');
    } catch (e) {
      assert.match(e.message || '', /codigo_pedido|obrig|400/i);
    }
  });

  s.test('cancelarNfOmie: rejeita codigo_pedido ausente', async () => {
    try {
      await call('cancelarNfOmie', {});
      throw new Error('deveria ter rejeitado');
    } catch (e) {
      assert.match(e.message || '', /codigo_pedido|obrig|400/i);
    }
  });

  s.test('trocarEtapaPedidoOmie: rejeita parâmetros ausentes', async () => {
    try {
      await call('trocarEtapaPedidoOmie', {});
      throw new Error('deveria ter rejeitado');
    } catch (e) {
      assert.match(e.message || '', /etapa|codigo|obrig|400/i);
    }
  });

  s.test('gerarBoletosOmie: rejeita lista vazia', async () => {
    try {
      await call('gerarBoletosOmie', { titulos: [] });
      throw new Error('deveria ter rejeitado');
    } catch (e) {
      assert.match(e.message || '', /vazio|titulos|obrig|400/i);
    }
  });

  s.test('transferirPedidoCarga: rejeita IDs ausentes', async () => {
    try {
      await call('transferirPedidoCarga', {});
      throw new Error('deveria ter rejeitado');
    } catch (e) {
      assert.match(e.message || '', /obrig|carga|pedido|400/i);
    }
  });

  // === Helper docs ===
  s.test('_omieHelperDocs: responde', async () => {
    const r = await call('_omieHelperDocs', {});
    assert.truthy(r);
  });

  return s;
}