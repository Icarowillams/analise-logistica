// ═══════════════════════════════════════════════════════════════════
// SUÍTE E2E — FLUXO COMPLETO DO PEDIDO até CHEGAR EM "FATURAR"
// ═══════════════════════════════════════════════════════════════════
// Botão único. Faz, em ordem REAL contra o Omie:
//   1. Localiza 1 cliente + 1 produto reais no banco
//   2. Cria 1 Pedido local (tipo venda)
//   3. Envia ao Omie (enviarPedidoOmie) → etapa 10
//   4. Libera no Omie (liberarPedidoOmie) → etapa 20
//   5. Trava etapa em 50 (faturar) → trocarEtapaPedidoOmie
//   6. Consulta o pedido no Omie pra confirmar etapa 50
//   7. Valida: o pedido APARECE na lista do Corte (etapas 10/20/50)
//   8. Valida: o pedido NÃO aparece em Acerto (porque etapa < 60)
//
// IMPORTANTE: testa apenas até a etapa "Faturar" (50) — NÃO emite NF real
// para não impactar a empresa. A emissão da NF (etapa 60) é manual.

import { createSuite, assert } from '@/lib/testRunner';
import { base44 } from '@/api/base44Client';

async function timed(fn, payload = {}) {
  const t0 = performance.now();
  const res = await base44.functions.invoke(fn, payload).catch(e => ({ data: { error: e.message } }));
  const ms = Math.round(performance.now() - t0);
  return { data: res?.data, ms };
}

// Contexto compartilhado entre testes da suíte
const ctx = {
  cliente: null,
  produto: null,
  pedidoLocalId: null,
  codigoPedidoOmie: null,
  numeroPedido: null,
};

export function buildSuiteE2EFluxoCompleto() {
  const s = createSuite('E2E — Digitar pedido → Enviar Omie → Liberar → Faturar');

  // ═════════════════════════════════════════════════════════
  // ETAPA 1: PREPARAÇÃO — encontrar cliente e produto reais
  // ═════════════════════════════════════════════════════════

  s.test('1. Localiza 1 cliente ATIVO com vínculo Omie (codigo_omie)', async () => {
    const clientes = await base44.entities.Cliente.filter({ status: 'ativo', tipo_nota: '55' }, '-updated_date', 50);
    const cli = clientes.find(c => c.codigo_omie && c.cnpj_cpf);
    assert.truthy(cli, 'Nenhum cliente ATIVO com codigo_omie encontrado no banco. Cadastre 1 cliente sincronizado com Omie.');
    ctx.cliente = cli;
    console.log(`[E2E] cliente: ${cli.razao_social} (codigo_omie: ${cli.codigo_omie})`);
  });

  s.test('2. Localiza 1 produto ATIVO sincronizado com Omie', async () => {
    const produtos = await base44.entities.Produto.filter({}, '-updated_date', 50);
    const prod = produtos.find(p =>
      p.codigo_omie || p.codigo_produto_integracao || p.codigo
    );
    assert.truthy(prod, 'Nenhum produto encontrado. Cadastre 1 produto sincronizado.');
    ctx.produto = prod;
    const codProd = prod.codigo_omie || prod.codigo_produto_integracao || prod.codigo;
    console.log(`[E2E] produto: ${prod.descricao} (cod: ${codProd})`);
  });

  // ═════════════════════════════════════════════════════════
  // ETAPA 2: CRIAR PEDIDO LOCAL
  // ═════════════════════════════════════════════════════════

  s.test('3. Cria Pedido LOCAL (tipo venda) no banco', async () => {
    if (!ctx.cliente || !ctx.produto) throw new Error('cliente/produto não localizado nas etapas anteriores');
    const pedido = await base44.entities.Pedido.create({
      tipo: 'venda',
      origem: 'sistema',
      status: 'pendente',
      etapa: 'comercial',
      cliente_id: ctx.cliente.id,
      cliente_codigo: ctx.cliente.codigo_interno || ctx.cliente.codigo_omie || '',
      cliente_nome: ctx.cliente.razao_social,
      cliente_nome_fantasia: ctx.cliente.nome_fantasia || '',
      cliente_cpf_cnpj: ctx.cliente.cnpj_cpf,
      cliente_cidade: ctx.cliente.cidade || '',
      cliente_estado: ctx.cliente.estado || '',
      modelo_nota: '55',
      total_itens: 1,
      valor_total: 10.00,
      observacoes: '[E2E TESTE AUTOMATIZADO] Pode ser cancelado.',
    });
    ctx.pedidoLocalId = pedido.id;
    assert.truthy(pedido.id, 'pedido local não criado');
    console.log(`[E2E] Pedido local criado: ${pedido.id}`);
  });

  // ═════════════════════════════════════════════════════════
  // ETAPA 3: ENVIAR AO OMIE (etapa 10)
  // ═════════════════════════════════════════════════════════

  s.test('4. Envia pedido ao Omie via enviarPedidoOmie → recebe codigo_pedido (etapa 10)', async () => {
    if (!ctx.pedidoLocalId) throw new Error('pedido local não foi criado');
    const { data, ms } = await timed('enviarPedidoOmie', { pedido_id: ctx.pedidoLocalId });
    console.log(`[E2E] enviarPedidoOmie em ${ms}ms`, JSON.stringify(data).slice(0, 200));
    if (data?.error) throw new Error(`Omie rejeitou: ${data.error}`);
    const cod = data?.codigo_pedido || data?.omie_codigo_pedido || data?.nCodPed;
    assert.truthy(cod, `Omie não retornou codigo_pedido. Retorno: ${JSON.stringify(data).slice(0, 200)}`);
    ctx.codigoPedidoOmie = cod;
    ctx.numeroPedido = data?.numero_pedido || data?.cNumPed || null;
    console.log(`[E2E] codigo_pedido Omie: ${cod} • numero: ${ctx.numeroPedido}`);
  });

  s.test('5. Confirma no Omie que o pedido está em etapa "10" (Pedido)', async () => {
    if (!ctx.codigoPedidoOmie) throw new Error('codigo_pedido não obtido');
    // Aguarda 2s pro Omie consolidar
    await new Promise(r => setTimeout(r, 2000));
    const { data, ms } = await timed('consultarPedidoOmie', { codigo_pedido: ctx.codigoPedidoOmie });
    console.log(`[E2E] consultarPedido em ${ms}ms`);
    const etapa = String(data?.pedido?.cabecalho?.etapa || '').trim();
    assert.equal(etapa, '10', `pedido deveria estar na etapa 10, está em ${etapa}`);
  });

  // ═════════════════════════════════════════════════════════
  // ETAPA 4: LIBERAR (etapa 20)
  // ═════════════════════════════════════════════════════════

  s.test('6. Libera pedido no Omie → etapa muda pra 20', async () => {
    if (!ctx.codigoPedidoOmie) throw new Error('codigo_pedido não obtido');
    const { data, ms } = await timed('liberarPedidoOmie', { codigo_pedido: ctx.codigoPedidoOmie });
    console.log(`[E2E] liberarPedido em ${ms}ms`, JSON.stringify(data).slice(0, 200));
    if (data?.error) {
      console.warn(`[E2E] liberarPedidoOmie retornou erro: ${data.error}`);
      // Se já estava liberado, tudo certo. Caso contrário, falha.
      if (!String(data.error).toLowerCase().includes('já')) {
        throw new Error(data.error);
      }
    }
    await new Promise(r => setTimeout(r, 2000));
    const { data: consult } = await timed('consultarPedidoOmie', { codigo_pedido: ctx.codigoPedidoOmie });
    const etapa = String(consult?.pedido?.cabecalho?.etapa || '').trim();
    assert.truthy(['20', '50'].includes(etapa), `pedido deveria estar em 20 (ou já em 50), está em ${etapa}`);
  });

  // ═════════════════════════════════════════════════════════
  // ETAPA 5: TROCAR PRA ETAPA 50 (Faturar) - PARA MONTAGEM DE CARGA
  // ═════════════════════════════════════════════════════════

  s.test('7. Trava etapa em 50 (Faturar) → trocarEtapaPedidoOmie', async () => {
    if (!ctx.codigoPedidoOmie) throw new Error('codigo_pedido não obtido');
    const { data, ms } = await timed('trocarEtapaPedidoOmie', {
      codigo_pedido: ctx.codigoPedidoOmie,
      nova_etapa: '50'
    });
    console.log(`[E2E] trocarEtapaPedido em ${ms}ms`, JSON.stringify(data).slice(0, 200));
    if (data?.error && !String(data.error).toLowerCase().includes('já')) {
      throw new Error(`Falha ao trocar etapa: ${data.error}`);
    }
    await new Promise(r => setTimeout(r, 2000));
    const { data: consult } = await timed('consultarPedidoOmie', { codigo_pedido: ctx.codigoPedidoOmie });
    const etapa = String(consult?.pedido?.cabecalho?.etapa || '').trim();
    assert.equal(etapa, '50', `pedido deveria estar em 50 (Faturar), está em ${etapa}`);
  });

  // ═════════════════════════════════════════════════════════
  // ETAPA 6: VALIDAR REGRAS DE EXIBIÇÃO
  // ═════════════════════════════════════════════════════════

  s.test('8. REGRA: pedido em etapa 50 APARECE no buscarPedidosOmie(etapa=50)', async () => {
    if (!ctx.codigoPedidoOmie) throw new Error('codigo_pedido não obtido');
    const { data, ms } = await timed('buscarPedidosOmie', {
      etapa: '50',
      registros_por_pagina: 100,
      buscar_todas_paginas: true,
    });
    console.log(`[E2E] buscarPedidosOmie etapa=50 em ${ms}ms → ${(data?.pedidos || []).length} pedidos`);
    const achou = (data?.pedidos || []).some(p => String(p.codigo_pedido) === String(ctx.codigoPedidoOmie));
    assert.truthy(achou, `pedido ${ctx.codigoPedidoOmie} deveria aparecer na lista etapa 50, mas não veio`);
  });

  s.test('9. REGRA: pedido em etapa 50 NÃO aparece em buscarPedidosOmie(etapa=60)', async () => {
    if (!ctx.codigoPedidoOmie) throw new Error('codigo_pedido não obtido');
    const { data } = await timed('buscarPedidosOmie', {
      etapa: '60',
      registros_por_pagina: 100,
      buscar_todas_paginas: false,
    });
    const apareceu = (data?.pedidos || []).some(p => String(p.codigo_pedido) === String(ctx.codigoPedidoOmie));
    assert.falsy(apareceu, `pedido em etapa 50 NÃO deveria aparecer em etapa 60, mas apareceu`);
  });

  // ═════════════════════════════════════════════════════════
  // ETAPA 7: LIMPEZA — cancelar o pedido de teste
  // ═════════════════════════════════════════════════════════

  s.test('10. LIMPEZA: cancela pedido no Omie pra não poluir empresa', async () => {
    if (!ctx.codigoPedidoOmie) return; // nada pra cancelar
    // Volta pra etapa 20 (que aceita cancelamento), depois cancela
    await timed('trocarEtapaPedidoOmie', { codigo_pedido: ctx.codigoPedidoOmie, nova_etapa: '20' });
    await new Promise(r => setTimeout(r, 1500));
    const { data, ms } = await timed('cancelarPedidoOmie', {
      pedido_id: ctx.pedidoLocalId,
      motivo: '[E2E TESTE AUTOMATIZADO] Limpeza após teste'
    });
    console.log(`[E2E] cancelarPedido em ${ms}ms`, JSON.stringify(data).slice(0, 200));
    // Mesmo se falhar, não quebra o teste — só registra
    if (data?.error) console.warn(`[E2E] limpeza falhou: ${data.error} — cancele manualmente o pedido ${ctx.codigoPedidoOmie}`);
  });

  s.test('11. LIMPEZA: remove pedido local do banco', async () => {
    if (!ctx.pedidoLocalId) return;
    await base44.entities.Pedido.delete(ctx.pedidoLocalId).catch(() => {});
  });

  return s;
}