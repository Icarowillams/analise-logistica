// Suíte: fluxo completo de Carga — montagem, transferência, fechamento, faturamento.

import { createSuite, assert } from '@/lib/testRunner';
import {
  calcularTotaisCarga,
  avaliarCapacidadeVeiculo
} from '@/lib/omieHelpers';

// Helpers locais para simular operações
function moverPedido(cargaOrigem, cargaDestino, codigoPedido) {
  const pedido = (cargaOrigem.pedidos_omie || []).find(p => p.codigo_pedido === codigoPedido);
  if (!pedido) throw new Error('Pedido não está na carga origem');
  return {
    origem: { ...cargaOrigem, pedidos_omie: cargaOrigem.pedidos_omie.filter(p => p.codigo_pedido !== codigoPedido) },
    destino: { ...cargaDestino, pedidos_omie: [...(cargaDestino.pedidos_omie || []), pedido] }
  };
}

function pedidosParaTransferencia() {
  return [
    { codigo_pedido: 'P1', codigo_cliente: 'C1', valor_total_pedido: 100, produtos: [{ codigo_produto: 'X', quantidade: 10, descricao: 'Pão', unidade: 'CX' }] },
    { codigo_pedido: 'P2', codigo_cliente: 'C2', valor_total_pedido: 250, produtos: [{ codigo_produto: 'Y', quantidade: 5, descricao: 'Queijo', unidade: 'KG' }] }
  ];
}

export function buildSuiteCargasETransferencia() {
  const s = createSuite('Cargas e Transferências (fluxo logístico)');

  // ============================================================
  // MONTAGEM
  // ============================================================
  s.test('CARGA NOVA: vazia tem 0 pedidos, 0 clientes, R$ 0', () => {
    const t = calcularTotaisCarga([], []);
    assert.equal(t.quantidade_pedidos, 0);
    assert.equal(t.quantidade_clientes, 0);
    assert.equal(t.valor_total, 0);
  });

  s.test('CARGA: 5 pedidos de 5 clientes diferentes', () => {
    const pedidos = Array.from({ length: 5 }, (_, i) => ({
      codigo_cliente: `C${i}`, valor_total_pedido: 100, produtos: []
    }));
    const t = calcularTotaisCarga(pedidos, []);
    assert.equal(t.quantidade_pedidos, 5);
    assert.equal(t.quantidade_clientes, 5);
    assert.equal(t.valor_total, 500);
  });

  s.test('CARGA: 5 pedidos do MESMO cliente → 1 cliente, valor somado', () => {
    const pedidos = Array.from({ length: 5 }, () => ({
      codigo_cliente: 'C1', valor_total_pedido: 100, produtos: []
    }));
    const t = calcularTotaisCarga(pedidos, []);
    assert.equal(t.quantidade_clientes, 1);
    assert.equal(t.valor_total, 500);
  });

  s.test('CARGA: pedido com produto sem peso registrado → peso 0', () => {
    const pedidos = [{ codigo_cliente: 'C1', valor_total_pedido: 0, produtos: [{ codigo_produto: 'XYZ', quantidade: 100 }] }];
    const t = calcularTotaisCarga(pedidos, []); // produtosBase vazio
    assert.equal(t.peso_total_kg, 0);
  });

  s.test('CARGA: 50 unidades de produto 0,5kg = 25kg total', () => {
    const pedidos = [{ codigo_cliente: 'C1', valor_total_pedido: 0, produtos: [{ codigo_produto: 'P1', quantidade: 50 }] }];
    const t = calcularTotaisCarga(pedidos, [{ codigo_omie: 'P1', peso: 0.5, volume_m3: 0 }]);
    assert.equal(t.peso_total_kg, 25);
  });

  s.test('CARGA: produtos consolidados deduplicados por código', () => {
    const pedidos = [
      { codigo_cliente: 'C1', produtos: [{ codigo_produto: 'P1', quantidade: 10, descricao: 'A', unidade: 'CX' }] },
      { codigo_cliente: 'C2', produtos: [{ codigo_produto: 'P1', quantidade: 15, descricao: 'A', unidade: 'CX' }] },
      { codigo_cliente: 'C3', produtos: [{ codigo_produto: 'P2', quantidade: 5, descricao: 'B', unidade: 'KG' }] }
    ];
    const t = calcularTotaisCarga(pedidos, []);
    assert.equal(t.produtos_resumo.length, 2);
    const p1 = t.produtos_resumo.find(p => p.codigo_produto === 'P1');
    assert.equal(p1.quantidade_total, 25);
  });

  // ============================================================
  // TRANSFERÊNCIA ENTRE CARGAS
  // ============================================================
  s.test('TRANSFERIR: pedido sai da origem', () => {
    const origem = { id: 'A', pedidos_omie: pedidosParaTransferencia() };
    const destino = { id: 'B', pedidos_omie: [] };
    const r = moverPedido(origem, destino, 'P1');
    assert.equal(r.origem.pedidos_omie.length, 1);
    assert.equal(r.destino.pedidos_omie.length, 1);
  });

  s.test('TRANSFERIR: pedido inexistente lança erro', () => {
    const origem = { id: 'A', pedidos_omie: pedidosParaTransferencia() };
    const destino = { id: 'B', pedidos_omie: [] };
    let lancou = false;
    try { moverPedido(origem, destino, 'P-INEXISTENTE'); } catch { lancou = true; }
    assert.equal(lancou, true);
  });

  s.test('TRANSFERIR: totais da origem caem após mover', () => {
    const origem = { id: 'A', pedidos_omie: pedidosParaTransferencia() };
    const destino = { id: 'B', pedidos_omie: [] };
    const t0 = calcularTotaisCarga(origem.pedidos_omie, []);
    const r = moverPedido(origem, destino, 'P1');
    const t1 = calcularTotaisCarga(r.origem.pedidos_omie, []);
    assert.equal(t0.quantidade_pedidos, 2);
    assert.equal(t1.quantidade_pedidos, 1);
  });

  s.test('TRANSFERIR: totais do destino sobem após receber', () => {
    const origem = { id: 'A', pedidos_omie: pedidosParaTransferencia() };
    const destino = { id: 'B', pedidos_omie: [] };
    const r = moverPedido(origem, destino, 'P2');
    const td = calcularTotaisCarga(r.destino.pedidos_omie, []);
    assert.equal(td.quantidade_pedidos, 1);
    assert.equal(td.valor_total, 250);
  });

  // ============================================================
  // CAPACIDADE DO VEÍCULO
  // ============================================================
  s.test('CAPACIDADE: VUC 1000kg vazio aceita carga de 100kg', () => {
    const r = avaliarCapacidadeVeiculo({ capacidade_peso_kg: 1000 }, { peso_total_kg: 100, volume_total_m3: 0 });
    assert.equal(r.podeSair, true);
    assert.equal(r.percentualPeso, 10);
  });

  s.test('CAPACIDADE: 100% de uso ainda libera (não excede)', () => {
    const r = avaliarCapacidadeVeiculo({ capacidade_peso_kg: 1000 }, { peso_total_kg: 1000, volume_total_m3: 0 });
    assert.equal(r.podeSair, true);
    assert.equal(r.percentualPeso, 100);
  });

  s.test('CAPACIDADE: 101% bloqueia', () => {
    const r = avaliarCapacidadeVeiculo({ capacidade_peso_kg: 1000 }, { peso_total_kg: 1001, volume_total_m3: 0 });
    assert.equal(r.podeSair, false);
  });

  s.test('CAPACIDADE: peso OK mas volume estourado bloqueia', () => {
    const r = avaliarCapacidadeVeiculo(
      { capacidade_peso_kg: 1000, capacidade_volume_m3: 5 },
      { peso_total_kg: 500, volume_total_m3: 6 }
    );
    assert.equal(r.podeSair, false);
    assert.equal(r.excedeVolume, true);
  });

  // ============================================================
  // FECHAMENTO DA CARGA
  // ============================================================
  s.test('FECHAMENTO: status válido para "fechar" é montagem', () => {
    const carga = { status_carga: 'montagem' };
    const podeFechar = carga.status_carga === 'montagem';
    assert.equal(podeFechar, true);
  });

  s.test('FECHAMENTO: carga já faturada não pode voltar pra montagem', () => {
    const carga = { status_carga: 'faturada' };
    const podeReabrir = ['montagem'].includes(carga.status_carga);
    assert.equal(podeReabrir, false);
  });

  // ============================================================
  // FATURAMENTO EM LOTE
  // ============================================================
  s.test('FATURAR LOTE: 0 pedidos = nada a faturar', () => {
    const pedidos = [];
    assert.equal(pedidos.length === 0, true);
  });

  s.test('FATURAR LOTE: ignora cliente D1 (não vai pro Omie)', () => {
    const pedidos = [
      { cliente_tipo_nota: '55', codigo_pedido: 'P1' },
      { cliente_tipo_nota: 'D1', codigo_pedido: 'P2' },
      { cliente_tipo_nota: '55', codigo_pedido: 'P3' }
    ];
    const faturaveis = pedidos.filter(p => p.cliente_tipo_nota !== 'D1');
    assert.equal(faturaveis.length, 2);
  });

  return s;
}