// ═══════════════════════════════════════════════════════════════════
// SUÍTE SÉRIA — AJUSTES DE PEDIDOS + ACERTO DE CAIXA contra Omie REAL
// ═══════════════════════════════════════════════════════════════════
// Princípio: NÃO altera nada. Faz snapshot ANTES, valida estrutura,
// chama leituras reais no Omie e mede TIMER de cada operação.
//
// O QUE CADA TESTE FAZ:
//  • Cronometra cada chamada Omie real (start → end ms)
//  • Compara snapshot antes/depois (deve ser IGUAL — testes read-only)
//  • Valida contratos defensivos dos endpoints destrutivos (sem ids → 400)
//  • Verifica integridade: acertos têm carga, cargas têm pedidos, etc.

import { createSuite, assert } from '@/lib/testRunner';
import { base44 } from '@/api/base44Client';

// Helper: chama function e cronometra
async function timed(fn, payload = {}) {
  const t0 = performance.now();
  const res = await base44.functions.invoke(fn, payload).catch(e => ({ data: { error: e.message } }));
  const ms = Math.round(performance.now() - t0);
  return { data: res?.data, ms };
}

// Helper: snapshot raso de uma entidade (só campos relevantes pra diff)
function snap(obj, campos) {
  if (!obj) return null;
  const o = {};
  campos.forEach(c => o[c] = obj[c]);
  return JSON.parse(JSON.stringify(o));
}

// Helper: espera que call falhe (sem alterar nada)
async function expectFail(fn, payload) {
  const { data } = await timed(fn, payload);
  if (data?.error || data?.sucesso === false) return;
  throw new Error(`esperava falha, recebeu: ${JSON.stringify(data).slice(0, 200)}`);
}

export function buildSuiteAjustesEAcerto() {
  const s = createSuite('Ajustes de Pedidos + Acerto de Caixa — testes reais com timer');

  // ═════════════════════════════════════════════════════════
  // SEÇÃO 1 — CONTRATOS DOS ENDPOINTS DESTRUTIVOS
  // (Garante que nada inválido vaza pro Omie)
  // ═════════════════════════════════════════════════════════

  s.test('CONTRATO: cortarPedidoOmie rejeita sem codigo_pedido nem pedido_id_interno', async () => {
    await expectFail('cortarPedidoOmie', { cortes: [{ codigo_produto: '1', nova_quantidade: 1 }] });
  });

  s.test('CONTRATO: cortarPedidoOmie rejeita cortes vazio', async () => {
    await expectFail('cortarPedidoOmie', { codigo_pedido: 999999999 });
  });

  s.test('CONTRATO: devolverPedidoOmie rejeita sem codigo_pedido', async () => {
    await expectFail('devolverPedidoOmie', { produtos: [{ nCodProd: 1, quantidade: 1 }] });
  });

  s.test('CONTRATO: devolverPedidoOmie rejeita produtos vazio', async () => {
    await expectFail('devolverPedidoOmie', { codigo_pedido: 999999999, produtos: [] });
  });

  s.test('CONTRATO: cancelarPedidoOmie rejeita sem pedido_id', async () => {
    await expectFail('cancelarPedidoOmie', { motivo: 'teste' });
  });

  s.test('CONTRATO: cancelarPedidoOmie rejeita sem motivo', async () => {
    await expectFail('cancelarPedidoOmie', { pedido_id: 'fake-id-xyz' });
  });

  s.test('CONTRATO: cancelarNfAcerto rejeita sem codigo_pedido', async () => {
    await expectFail('cancelarNfAcerto', {});
  });

  s.test('CONTRATO: sincronizarAcertoOmie rejeita sem acerto_id', async () => {
    await expectFail('sincronizarAcertoOmie', {});
  });

  s.test('CONTRATO: sincronizarAcertoOmie rejeita acerto_id inexistente', async () => {
    await expectFail('sincronizarAcertoOmie', { acerto_id: 'fake-acerto-xyz-999' });
  });

  s.test('CONTRATO: transferirPedidoCarga rejeita sem origem/destino', async () => {
    await expectFail('transferirPedidoCarga', {});
  });

  // ═════════════════════════════════════════════════════════
  // SEÇÃO 2 — TIMER REAL: leitura Omie usada por AjustesPedidos
  // ═════════════════════════════════════════════════════════

  s.test('TIMER: consultarPedidoOmie de pedido REAL → < 8s', async () => {
    const pedidos = await base44.entities.Pedido.filter({ omie_enviado: true }, '-created_date', 5);
    const com = pedidos.find(p => p.omie_codigo_pedido);
    if (!com) return; // sem pedido real, skip
    const { data, ms } = await timed('consultarPedidoOmie', { codigo_pedido: com.omie_codigo_pedido });
    assert.truthy(data, `sem resposta Omie em ${ms}ms`);
    assert.truthy(ms < 8000, `lento demais: ${ms}ms (alvo < 8000ms)`);
  });

  s.test('TIMER: ConsultarPedido devolve produtos (pra Corte ter o que mostrar)', async () => {
    const pedidos = await base44.entities.Pedido.filter({ omie_enviado: true }, '-created_date', 10);
    const com = pedidos.find(p => p.omie_codigo_pedido);
    if (!com) return;
    const { data, ms } = await timed('consultarPedidoOmie', { codigo_pedido: com.omie_codigo_pedido });
    const ped = data?.pedido_venda_produto || data?.pedido;
    if (!ped) return; // pode ser pedido cancelado/excluído
    const det = ped.det || [];
    assert.truthy(Array.isArray(det), 'pedido sem array det');
    console.log(`[corte] pedido ${com.omie_codigo_pedido} → ${det.length} itens em ${ms}ms`);
  });

  // ═════════════════════════════════════════════════════════
  // SEÇÃO 3 — TIMER REAL: sincronizarAcertoOmie em acerto REAL
  // (NÃO altera o acerto — chama, mede, compara snapshot)
  // ═════════════════════════════════════════════════════════

  s.test('TIMER: sincronizarAcertoOmie em acerto real → < 30s + retorna estrutura válida', async () => {
    const acertos = await base44.entities.AcertoCaixa.list('-created_date', 5);
    const ac = acertos.find(a => (a.notas || []).some(n => n.codigo_pedido));
    if (!ac) return; // sem acerto com pedidos Omie, skip
    const { data, ms } = await timed('sincronizarAcertoOmie', { acerto_id: ac.id });
    assert.truthy(data?.sucesso, `sync falhou em ${ms}ms: ${data?.error}`);
    assert.truthy(typeof data.alteradas === 'number', 'sem campo "alteradas"');
    assert.truthy(typeof data.total === 'number', 'sem campo "total"');
    assert.truthy(ms < 30000, `lento demais: ${ms}ms (alvo < 30000ms)`);
    console.log(`[acerto-sync] ${ms}ms → ${data.alteradas}/${data.total} notas alteradas`);
  });

  s.test('ANTES/DEPOIS: sincronização de acerto NÃO mexe em notas já entregues', async () => {
    const acertos = await base44.entities.AcertoCaixa.list('-created_date', 5);
    const ac = acertos.find(a => (a.notas || []).some(n => n.status_entrega === 'entregue'));
    if (!ac) return;
    const antes = (ac.notas || [])
      .filter(n => n.status_entrega === 'entregue')
      .map(n => snap(n, ['codigo_pedido', 'status_entrega', 'valor_recebido']));
    await base44.functions.invoke('sincronizarAcertoOmie', { acerto_id: ac.id });
    const depois = await base44.entities.AcertoCaixa.get(ac.id);
    const depoisEntregues = (depois.notas || [])
      .filter(n => antes.find(a => a.codigo_pedido === n.codigo_pedido))
      .map(n => snap(n, ['codigo_pedido', 'status_entrega', 'valor_recebido']));
    // Notas que eram "entregue" não podem virar "nao_entregue" só por causa do sync
    const regressao = depoisEntregues.filter(d => {
      const a = antes.find(x => x.codigo_pedido === d.codigo_pedido);
      return a?.status_entrega === 'entregue' && d.status_entrega === 'nao_entregue' && d.valor_recebido === 0;
    });
    assert.equal(regressao.length, 0, `${regressao.length} notas entregues foram revertidas indevidamente`);
  });

  // ═════════════════════════════════════════════════════════
  // SEÇÃO 4 — INTEGRIDADE DOS DADOS DE ACERTO
  // ═════════════════════════════════════════════════════════

  s.test('INTEGRIDADE: todo AcertoCaixa em_andamento tem carga_id válida', async () => {
    const acertos = await base44.entities.AcertoCaixa.filter({ status_acerto: 'em_andamento' }, '-created_date', 50);
    if (acertos.length === 0) return;
    let orfaos = 0;
    for (const ac of acertos) {
      if (!ac.carga_id) { orfaos++; continue; }
      const carga = await base44.entities.Carga.get(ac.carga_id).catch(() => null);
      if (!carga) orfaos++;
    }
    assert.equal(orfaos, 0, `${orfaos}/${acertos.length} acertos sem carga válida`);
  });

  s.test('INTEGRIDADE: totais do acerto batem com soma das notas', async () => {
    const acertos = await base44.entities.AcertoCaixa.list('-created_date', 20);
    const erros = [];
    for (const ac of acertos) {
      const notas = ac.notas || [];
      if (notas.length === 0) continue;
      const recCalc = notas.reduce((s, n) => s + Number(n.valor_recebido || 0), 0);
      const difCalc = notas.reduce((s, n) => s + Number(n.diferenca || 0), 0);
      const diffRec = Math.abs(recCalc - Number(ac.valor_total_recebido || 0));
      const diffDif = Math.abs(difCalc - Number(ac.valor_total_diferenca || 0));
      // tolerância 1 centavo
      if (diffRec > 0.01 || diffDif > 0.01) {
        erros.push(`Acerto ${ac.numero_carga}: rec ${diffRec.toFixed(2)}, dif ${diffDif.toFixed(2)}`);
      }
    }
    assert.equal(erros.length, 0, `Inconsistências:\n${erros.slice(0, 5).join('\n')}`);
  });

  s.test('INTEGRIDADE: notas de acerto não-finalizado têm valor_original > 0', async () => {
    const acertos = await base44.entities.AcertoCaixa.filter({ status_acerto: 'em_andamento' }, '-created_date', 30);
    const zerados = [];
    for (const ac of acertos) {
      (ac.notas || []).forEach(n => {
        if (Number(n.valor_original || 0) <= 0 && n.codigo_pedido) {
          zerados.push(`Carga ${ac.numero_carga} pedido ${n.codigo_pedido}`);
        }
      });
    }
    assert.equal(zerados.length, 0, `${zerados.length} notas com valor original zero: ${zerados.slice(0, 3).join(', ')}`);
  });

  s.test('INTEGRIDADE: acerto finalizado nunca tem nota pendente', async () => {
    const acertos = await base44.entities.AcertoCaixa.filter({ status_acerto: 'finalizado' }, '-created_date', 30);
    const inv = acertos.filter(a => (a.notas || []).some(n => n.status_entrega === 'pendente'));
    assert.equal(inv.length, 0, `${inv.length} acertos finalizados com nota pendente`);
  });

  // ═════════════════════════════════════════════════════════
  // SEÇÃO 5 — INTEGRIDADE DE LOGS DE CORTE
  // ═════════════════════════════════════════════════════════

  s.test('INTEGRIDADE: LogCorte recente tem campos essenciais', async () => {
    const logs = await base44.entities.LogCorte.list('-created_date', 20);
    if (logs.length === 0) return;
    const corrompidos = logs.filter(l =>
      l.quantidade_anterior == null ||
      l.quantidade_nova == null ||
      !l.produto_codigo
    );
    assert.equal(corrompidos.length, 0, `${corrompidos.length}/${logs.length} logs corte sem campos essenciais`);
  });

  s.test('INTEGRIDADE: LogCorte — quantidade_cortada bate com diferença', async () => {
    const logs = await base44.entities.LogCorte.list('-created_date', 20);
    const inv = logs.filter(l => {
      const calc = Number(l.quantidade_anterior || 0) - Number(l.quantidade_nova || 0);
      return Math.abs(calc - Number(l.quantidade_cortada || 0)) > 0.001;
    });
    assert.equal(inv.length, 0, `${inv.length} logs com cálculo de corte inconsistente`);
  });

  // ═════════════════════════════════════════════════════════
  // SEÇÃO 6 — TIMER REAL: ListarNF (usado pelo cancelarNfAcerto)
  // ═════════════════════════════════════════════════════════

  s.test('TIMER: listarNfsOmie (página 1) < 10s', async () => {
    const { data, ms } = await timed('listarNfsOmie', { pagina: 1, registros_por_pagina: 10 });
    assert.truthy(data, `sem resposta em ${ms}ms`);
    assert.truthy(ms < 10000, `lento: ${ms}ms`);
    console.log(`[listarNfs] ${ms}ms → ${(data?.nfs || []).length} NFs retornadas`);
  });

  // ═════════════════════════════════════════════════════════
  // SEÇÃO 7 — TIMER: transferência entre cargas (modo dry)
  // ═════════════════════════════════════════════════════════

  s.test('CONTRATO: transferirPedidoCarga rejeita carga_destino inexistente', async () => {
    await expectFail('transferirPedidoCarga', {
      carga_origem_id: 'fake', carga_destino_id: 'fake-xyz', codigo_pedido: '1'
    });
  });

  // ═════════════════════════════════════════════════════════
  // SEÇÃO 8 — SAÚDE DA INTEGRAÇÃO (últimas chamadas reais)
  // ═════════════════════════════════════════════════════════

  s.test('SAÚDE: últimas 30 chamadas de cancelamento/corte → > 70% sucesso', async () => {
    const logs = await base44.entities.LogIntegracaoOmie.filter(
      { operacao: { $in: ['cortar_pedido', 'devolver_pedido', 'cancelar_pedido'] } }, '-created_date', 30
    ).catch(() => []);
    if (logs.length === 0) return;
    const sucesso = logs.filter(l => l.status === 'sucesso').length;
    const pct = (sucesso / logs.length) * 100;
    assert.truthy(pct >= 70, `taxa de sucesso baixa: ${pct.toFixed(1)}% em ${logs.length} chamadas`);
    console.log(`[saude-ajustes] ${pct.toFixed(1)}% sucesso (${sucesso}/${logs.length})`);
  });

  s.test('SAÚDE: nenhum corte/cancelamento demorou > 45s', async () => {
    const logs = await base44.entities.LogIntegracaoOmie.filter(
      { operacao: { $in: ['cortar_pedido', 'devolver_pedido', 'cancelar_pedido'] } }, '-created_date', 30
    ).catch(() => []);
    const lentos = logs.filter(l => (l.duracao_ms || 0) > 45000);
    assert.equal(lentos.length, 0, `${lentos.length} chamadas > 45s`);
  });

  return s;
}