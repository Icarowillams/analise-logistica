// Suíte: simula JORNADAS REAIS de um usuário do sistema usando dados em memória.
// Não chama backend, não toca em entidades. Valida o "se eu fizer X, espero Y".

import { createSuite, assert } from '@/lib/testRunner';
import {
  validarPedidoParaEnvio,
  resolverClienteOmie,
  calcularPrecoProduto,
  gerarParcelas,
  calcularTotaisCarga,
  avaliarCapacidadeVeiculo,
  avaliarBloqueio,
  classificarStatusNF,
  labelEtapa,
  converterParaCaixas
} from '@/lib/omieHelpers';

export function buildSuiteFluxosUsuario() {
  const s = createSuite('Fluxos Reais do Usuário (cenários ponta-a-ponta)');

  // ============================================================
  // FLUXO 1 — Vendedor monta pedido e envia ao Omie
  // ============================================================
  s.test('FLUXO 1.1: pedido novo válido (cliente + data + 2 itens) → passa validação', () => {
    const pedido = {
      tipo: 'venda',
      cliente_id: 'cli-001',
      data_previsao_entrega: '2026-05-10',
      omie_enviado: false
    };
    const itens = [
      { produto_id: 'p1', quantidade: 5, valor_unitario: 10 },
      { produto_id: 'p2', quantidade: 2, valor_unitario: 25 }
    ];
    const r = validarPedidoParaEnvio(pedido, itens);
    assert.equal(r.valido, true, JSON.stringify(r.erros));
  });

  s.test('FLUXO 1.2: pedido sem cliente → bloqueia envio', () => {
    const r = validarPedidoParaEnvio({ tipo: 'venda', data_previsao_entrega: '2026-05-10' }, [{ produto_id: 'p1', quantidade: 1, valor_unitario: 10 }]);
    assert.equal(r.valido, false);
    assert.includes(r.erros, 'Cliente não informado');
  });

  s.test('FLUXO 1.3: pedido sem data de entrega → bloqueia (regra Omie)', () => {
    const r = validarPedidoParaEnvio({ tipo: 'venda', cliente_id: 'cli-1' }, [{ produto_id: 'p1', quantidade: 1, valor_unitario: 10 }]);
    assert.equal(r.valido, false);
    assert.includes(r.erros, 'Data de previsão de entrega obrigatória');
  });

  s.test('FLUXO 1.4: pedido sem itens → bloqueia', () => {
    const r = validarPedidoParaEnvio({ tipo: 'venda', cliente_id: 'cli-1', data_previsao_entrega: '2026-05-10' }, []);
    assert.equal(r.valido, false);
    assert.includes(r.erros, 'Pedido sem itens');
  });

  s.test('FLUXO 1.5: item com quantidade zero → bloqueia', () => {
    const r = validarPedidoParaEnvio(
      { tipo: 'venda', cliente_id: 'cli-1', data_previsao_entrega: '2026-05-10' },
      [{ produto_id: 'p1', quantidade: 0, valor_unitario: 10 }]
    );
    assert.equal(r.valido, false);
  });

  s.test('FLUXO 1.6: item com valor unitário negativo → bloqueia', () => {
    const r = validarPedidoParaEnvio(
      { tipo: 'venda', cliente_id: 'cli-1', data_previsao_entrega: '2026-05-10' },
      [{ produto_id: 'p1', quantidade: 1, valor_unitario: -5 }]
    );
    assert.equal(r.valido, false);
  });

  s.test('FLUXO 1.7: pedido troca → bloqueia envio (regra de negócio)', () => {
    const r = validarPedidoParaEnvio(
      { tipo: 'troca', cliente_id: 'cli-1', data_previsao_entrega: '2026-05-10' },
      [{ produto_id: 'p1', quantidade: 1, valor_unitario: 10 }]
    );
    assert.equal(r.valido, false);
    assert.includes(r.erros, 'Pedido de troca não envia ao Omie');
  });

  s.test('FLUXO 1.8: pedido já enviado → bloqueia reenvio', () => {
    const r = validarPedidoParaEnvio(
      { tipo: 'venda', cliente_id: 'cli-1', data_previsao_entrega: '2026-05-10', omie_enviado: true, omie_codigo_pedido: '123' },
      [{ produto_id: 'p1', quantidade: 1, valor_unitario: 10 }]
    );
    assert.equal(r.valido, false);
    assert.includes(r.erros, 'Pedido já enviado ao Omie');
  });

  // ============================================================
  // FLUXO 2 — Cliente bloqueado/inadimplente
  // ============================================================
  s.test('FLUXO 2.1: cliente novo, sem títulos, sem limite → libera', () => {
    const r = avaliarBloqueio({ titulosOmie: [], limiteCredito: 0, saldoUtilizado: 0 });
    assert.equal(r.bloqueado, false);
  });

  s.test('FLUXO 2.2: cliente com 1 título atrasado → bloqueia mesmo com limite OK', () => {
    const r = avaliarBloqueio({ titulosOmie: [{ status_titulo: 'ATRASADO' }], limiteCredito: 10000, saldoUtilizado: 0 });
    assert.equal(r.bloqueado, true);
  });

  s.test('FLUXO 2.3: cliente com limite ESTOURADO → bloqueia', () => {
    const r = avaliarBloqueio({ titulosOmie: [{ status_titulo: 'ABERTO' }], limiteCredito: 1000, saldoUtilizado: 1500 });
    assert.equal(r.bloqueado, true);
    assert.equal(r.limiteEstourado, true);
  });

  s.test('FLUXO 2.4: cliente no limite exato → ainda libera (não estourou)', () => {
    const r = avaliarBloqueio({ titulosOmie: [], limiteCredito: 1000, saldoUtilizado: 1000 });
    assert.equal(r.bloqueado, false);
  });

  s.test('FLUXO 2.5: 5 títulos abertos (não atrasados) + sem limite → libera', () => {
    const titulos = Array(5).fill({ status_titulo: 'ABERTO' });
    const r = avaliarBloqueio({ titulosOmie: titulos, limiteCredito: 0, saldoUtilizado: 0 });
    assert.equal(r.bloqueado, false);
  });

  // ============================================================
  // FLUXO 3 — Resolução de cliente no Omie (3 estratégias)
  // ============================================================
  s.test('FLUXO 3.1: encontra cliente por codigo_omie direto', () => {
    const r = resolverClienteOmie({
      pedido: { cliente_id: 'cli-1', cliente_cpf_cnpj: '12345678000100' },
      cliente: { codigo_omie: 'OMIE-999', cnpj_cpf: '12345678000100' },
      clientesOmieMap: { 'OMIE-999': { codigo_cliente_omie: 999 } }
    });
    assert.equal(r.origem, 'codigo_omie');
  });

  s.test('FLUXO 3.2: cai pra codigo_integracao quando codigo_omie falha', () => {
    const r = resolverClienteOmie({
      pedido: { cliente_id: 'cli-base44', cliente_cpf_cnpj: '99999999999' },
      cliente: { cnpj_cpf: '99999999999' },
      clientesOmieMap: { 'cli-base44': { codigo_cliente_omie: 100 } }
    });
    assert.equal(r.origem, 'codigo_integracao');
    assert.equal(r.codigoIntegracao, 'cli-base44');
  });

  s.test('FLUXO 3.3: fallback final por CPF/CNPJ quando os 2 acima falham', () => {
    const r = resolverClienteOmie({
      pedido: { cliente_id: 'cli-novo', cliente_cpf_cnpj: '11.222.333/0001-81' },
      cliente: { cnpj_cpf: '11.222.333/0001-81' },
      clientesOmieMap: {},
      clientesOmiePorCpf: { '11222333000181': { codigo_cliente_integracao: 'cli-antigo' } }
    });
    assert.equal(r.origem, 'cpf_cnpj');
    assert.equal(r.codigoIntegracao, 'cli-antigo');
  });

  s.test('FLUXO 3.4: cliente totalmente novo → não encontrado', () => {
    const r = resolverClienteOmie({
      pedido: { cliente_id: 'cli-novo', cliente_cpf_cnpj: '00000000000' },
      cliente: { cnpj_cpf: '00000000000' },
      clientesOmieMap: {},
      clientesOmiePorCpf: {}
    });
    assert.equal(r.origem, 'nao_encontrado');
  });

  // ============================================================
  // FLUXO 4 — Montagem de carga e capacidade do veículo
  // ============================================================
  s.test('FLUXO 4.1: carga vazia → totais zerados', () => {
    const t = calcularTotaisCarga([], []);
    assert.equal(t.peso_total_kg, 0);
    assert.equal(t.volume_total_m3, 0);
    assert.equal(t.valor_total, 0);
    assert.equal(t.quantidade_pedidos, 0);
  });

  s.test('FLUXO 4.2: carga com 2 pedidos do mesmo cliente → 2 pedidos, 1 cliente', () => {
    const pedidos = [
      { codigo_cliente: 'C1', valor_total_pedido: 100, produtos: [] },
      { codigo_cliente: 'C1', valor_total_pedido: 50, produtos: [] }
    ];
    const t = calcularTotaisCarga(pedidos, []);
    assert.equal(t.quantidade_pedidos, 2);
    assert.equal(t.quantidade_clientes, 1);
    assert.equal(t.valor_total, 150);
  });

  s.test('FLUXO 4.3: peso e volume calculados a partir dos produtos', () => {
    const pedidos = [{
      codigo_cliente: 'C1', valor_total_pedido: 0,
      produtos: [{ codigo_produto: 'P1', quantidade: 10, descricao: 'Pão' }]
    }];
    const produtosBase = [{ codigo_omie: 'P1', peso: 0.5, volume_m3: 0.001 }];
    const t = calcularTotaisCarga(pedidos, produtosBase);
    assert.equal(t.peso_total_kg, 5);
    assert.equal(t.volume_total_m3, 0.01);
  });

  s.test('FLUXO 4.4: produtos consolidados somam quantidades de pedidos diferentes', () => {
    const pedidos = [
      { codigo_cliente: 'C1', produtos: [{ codigo_produto: 'P1', quantidade: 5, descricao: 'A', unidade: 'UN' }] },
      { codigo_cliente: 'C2', produtos: [{ codigo_produto: 'P1', quantidade: 3, descricao: 'A', unidade: 'UN' }] }
    ];
    const t = calcularTotaisCarga(pedidos, []);
    assert.equal(t.produtos_resumo.length, 1);
    assert.equal(t.produtos_resumo[0].quantidade_total, 8);
  });

  s.test('FLUXO 4.5: VUC com peso dentro do limite → pode sair', () => {
    const totais = { peso_total_kg: 800, volume_total_m3: 4 };
    const veiculo = { capacidade_peso_kg: 1000, capacidade_volume_m3: 6 };
    const r = avaliarCapacidadeVeiculo(veiculo, totais);
    assert.equal(r.podeSair, true);
    assert.equal(r.percentualPeso, 80);
  });

  s.test('FLUXO 4.6: VUC com peso EXCEDENTE → não pode sair', () => {
    const r = avaliarCapacidadeVeiculo(
      { capacidade_peso_kg: 1000, capacidade_volume_m3: 6 },
      { peso_total_kg: 1200, volume_total_m3: 4 }
    );
    assert.equal(r.podeSair, false);
    assert.equal(r.excedePeso, true);
  });

  s.test('FLUXO 4.7: VUC com volume EXCEDENTE → não pode sair', () => {
    const r = avaliarCapacidadeVeiculo(
      { capacidade_peso_kg: 1000, capacidade_volume_m3: 6 },
      { peso_total_kg: 500, volume_total_m3: 7 }
    );
    assert.equal(r.podeSair, false);
    assert.equal(r.excedeVolume, true);
  });

  s.test('FLUXO 4.8: veículo sem capacidade definida → não bloqueia', () => {
    const r = avaliarCapacidadeVeiculo({}, { peso_total_kg: 99999, volume_total_m3: 9999 });
    assert.equal(r.podeSair, true);
  });

  // ============================================================
  // FLUXO 5 — Etapas Omie (jornada do pedido)
  // ============================================================
  s.test('FLUXO 5.1: etapa 10 = Pedido de Venda', () => {
    assert.equal(labelEtapa('10'), 'Pedido de Venda');
  });
  s.test('FLUXO 5.2: etapa 20 = Pedidos Liberados', () => {
    assert.equal(labelEtapa('20'), 'Pedidos Liberados');
  });
  s.test('FLUXO 5.3: etapa 50 = Faturar', () => {
    assert.equal(labelEtapa('50'), 'Faturar');
  });
  s.test('FLUXO 5.4: etapa 60 = Faturado', () => {
    assert.equal(labelEtapa('60'), 'Faturado');
  });
  s.test('FLUXO 5.5: etapa desconhecida tem fallback', () => {
    assert.match(labelEtapa('99'), /Etapa 99/);
  });

  // ============================================================
  // FLUXO 6 — Status NF (SEFAZ)
  // ============================================================
  s.test('FLUXO 6.1: cStat 100 = NF emitida', () => {
    assert.equal(classificarStatusNF('100').status, 'emitida');
  });
  s.test('FLUXO 6.2: cStat 101 = NF cancelada', () => {
    assert.equal(classificarStatusNF('101').status, 'cancelada');
  });
  s.test('FLUXO 6.3: cStat 110 = NF denegada', () => {
    assert.equal(classificarStatusNF('110').status, 'denegada');
  });
  s.test('FLUXO 6.4: cStat 215 = NF rejeitada', () => {
    assert.equal(classificarStatusNF('215').status, 'rejeitada');
  });
  s.test('FLUXO 6.5: cStat vazio = desconhecido', () => {
    assert.equal(classificarStatusNF('').status, 'desconhecido');
  });

  // ============================================================
  // FLUXO 7 — Pricing complexo (cenários do dia-a-dia)
  // ============================================================
  s.test('FLUXO 7.1: cliente VIP com ação promocional ativa hoje → preço promo', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'cli-vip', tabela_id: 'atacado', hoje: '2026-05-01',
      acoes: [{
        produto_id: 'p1', tabela_id: 'atacado', clientes_ids: ['cli-vip'],
        status: 'ativa', data_inicio: '2026-04-01', data_fim: '2026-05-31', valor_acao: 7.5
      }],
      precos: [{ produto_id: 'p1', tabela_id: 'atacado', valor_unitario: 10 }]
    });
    assert.equal(r.valor, 7.5);
  });

  s.test('FLUXO 7.2: ação promocional FUTURA não aplica hoje', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'cli-1', tabela_id: 't1', hoje: '2026-05-01',
      acoes: [{ produto_id: 'p1', tabela_id: 't1', status: 'ativa', data_inicio: '2026-06-01', data_fim: '2026-12-31', valor_acao: 1 }],
      precos: [{ produto_id: 'p1', tabela_id: 't1', valor_unitario: 10 }]
    });
    assert.equal(r.valor, 10);
  });

  s.test('FLUXO 7.3: ação promocional INATIVA é ignorada', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'cli-1', tabela_id: 't1', hoje: '2026-05-01',
      acoes: [{ produto_id: 'p1', tabela_id: 't1', status: 'inativa', data_inicio: '2026-01-01', data_fim: '2026-12-31', valor_acao: 1 }],
      precos: [{ produto_id: 'p1', tabela_id: 't1', valor_unitario: 10 }]
    });
    assert.equal(r.valor, 10);
  });

  s.test('FLUXO 7.4: ação sem clientes_ids → vale para todos', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'qualquer-cli', tabela_id: 't1', hoje: '2026-05-01',
      acoes: [{ produto_id: 'p1', tabela_id: 't1', clientes_ids: [], status: 'ativa', data_inicio: '2026-01-01', data_fim: '2026-12-31', valor_acao: 6 }],
      precos: [{ produto_id: 'p1', tabela_id: 't1', valor_unitario: 10 }]
    });
    assert.equal(r.valor, 6);
  });

  s.test('FLUXO 7.5: tabela errada → cai no preço base', () => {
    const r = calcularPrecoProduto({
      produto_id: 'p1', cliente_id: 'cli-1', tabela_id: 't-errada', hoje: '2026-05-01',
      acoes: [],
      precos: [
        { produto_id: 'p1', tabela_id: 't1', valor_unitario: 5 },
        { produto_id: 'p1', tabela_id: 't-errada', valor_unitario: 10 }
      ]
    });
    assert.equal(r.valor, 10);
  });

  // ============================================================
  // FLUXO 8 — Geração de parcelas (financeiro)
  // ============================================================
  s.test('FLUXO 8.1: 30/60/90 com R$ 99,99 → 3 parcelas que somam 99.99', () => {
    const p = gerarParcelas({ numero_parcelas: 3, dias_primeira_parcela: 30 }, 99.99, new Date('2026-01-01T12:00:00'));
    const soma = p.reduce((s, x) => s + x.valor, 0);
    assert.equal(Math.round(soma * 100) / 100, 99.99);
  });

  s.test('FLUXO 8.2: 12 parcelas de R$ 1000 → soma exata 1000', () => {
    const p = gerarParcelas({ numero_parcelas: 12, dias_primeira_parcela: 30 }, 1000, new Date('2026-01-01T12:00:00'));
    assert.equal(p.length, 12);
    const soma = p.reduce((s, x) => s + x.valor, 0);
    assert.equal(Math.round(soma * 100) / 100, 1000);
  });

  s.test('FLUXO 8.3: parcela 2 vence 30 dias após a 1ª', () => {
    const p = gerarParcelas({ numero_parcelas: 2, dias_primeira_parcela: 30 }, 100, new Date('2026-01-01T12:00:00'));
    // 30 dias após 01/01 = 31/01; 60 dias = 02/03 (não bissexto)
    assert.equal(p[0].data_vencimento, '31/01/2026');
    assert.equal(p[1].data_vencimento, '02/03/2026');
  });

  // ============================================================
  // FLUXO 9 — Fator caixa (logística)
  // ============================================================
  s.test('FLUXO 9.1: 12 unidades + fator 12 = 1 caixa', () => {
    const r = converterParaCaixas(12, 12, true);
    assert.equal(r.caixas, 1);
    assert.equal(r.fracionado, 0);
  });

  s.test('FLUXO 9.2: 13 unidades + fator 12 + permite fracionado = 1 caixa + 1 unidade', () => {
    const r = converterParaCaixas(13, 12, true);
    assert.equal(r.caixas, 1);
    assert.equal(r.fracionado, 1);
  });

  s.test('FLUXO 9.3: 13 unidades + fator 12 + NÃO permite fracionado = 2 caixas (arredonda pra cima)', () => {
    const r = converterParaCaixas(13, 12, false);
    assert.equal(r.caixas, 2);
    assert.equal(r.ajustado, true);
  });

  s.test('FLUXO 9.4: produto sem fator caixa (1) → quantidade = caixas', () => {
    const r = converterParaCaixas(7, 1, true);
    assert.equal(r.caixas, 7);
  });

  return s;
}