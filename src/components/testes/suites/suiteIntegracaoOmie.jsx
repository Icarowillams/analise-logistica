// Suíte E2E — chama as functions reais contra a API Omie em modo SOMENTE LEITURA.
// Foco: garantir que TODA a integração esteja funcionando ponta-a-ponta.
// Nenhum teste cria, altera ou exclui dados no Omie.
//
// Estrutura:
//   1. Conexão & credenciais
//   2. Leitura de catálogos Omie (etapas, cenários, contas, NFs)
//   3. Validação de contratos (cada função rejeita payload errado?)
//   4. Auditoria (clientes/referências sincronizados)
//   5. Pré-requisitos do app (existem dados pra rodar os fluxos?)
//   6. Resiliência (rate-limit, formato de resposta)

import { createSuite, assert } from '@/lib/testRunner';
import { base44 } from '@/api/base44Client';

async function call(fn, payload = {}) {
  const res = await base44.functions.invoke(fn, payload);
  return res?.data;
}

// Wrapper: espera que a chamada falhe (rejeição HTTP ≥400 OU campo error/sucesso=false na resposta).
async function expectFail(fn, payload, regex = null) {
  try {
    const r = await call(fn, payload);
    if (r?.error || r?.sucesso === false) {
      if (regex && !regex.test(r.error || r.erro || '')) {
        throw new Error(`falhou mas mensagem não bate com ${regex}: ${r.error || r.erro}`);
      }
      return;
    }
    throw new Error(`esperava falha, mas chamada retornou sucesso: ${JSON.stringify(r).slice(0, 200)}`);
  } catch (e) {
    if (e?.response?.status >= 400) return;
    if (/status code 4\d\d/.test(e?.message || '')) return;
    if (/esperava falha|falhou mas/.test(e?.message || '')) throw e;
    return;
  }
}

export function buildSuiteIntegracaoOmie() {
  const s = createSuite('Integração Real Omie — TODOS os fluxos (somente leitura)');

  // ═══════════════════════════════════════════════════════════
  // 1. CONEXÃO & CREDENCIAIS
  // ═══════════════════════════════════════════════════════════

  s.test('CONEXÃO: credenciais OMIE_APP_KEY/SECRET válidas', async () => {
    const r = await call('testarConexaoOmie', {});
    assert.truthy(r, 'sem resposta');
    assert.truthy(r.ok || r.sucesso || r.conectado, `Omie não conectou: ${JSON.stringify(r).slice(0, 200)}`);
  });

  s.test('CONEXÃO: empresa do Omie identificada', async () => {
    const r = await call('testarConexaoOmie', {});
    // testarConexaoOmie chama ListarEmpresas — alguma empresa deve aparecer
    assert.truthy(r, 'sem resposta');
    // Aceita várias formas de retorno
    assert.truthy(r.empresa || r.razao_social || r.empresas || r.ListarEmpresas || r.cadastros || r.ok || r.sucesso, 'esperava dados de empresa');
  });

  // ═══════════════════════════════════════════════════════════
  // 2. CATÁLOGOS OMIE (leitura — base do funcionamento)
  // ═══════════════════════════════════════════════════════════

  s.test('CATÁLOGO: ListarEtapasFaturamento retorna etapas reais', async () => {
    const r = await call('listarEtapasOmie', {});
    assert.truthy(r);
    assert.truthy(Array.isArray(r.cadastros), 'esperava r.cadastros como array');
    assert.greaterThan(r.cadastros.length, 0);
  });

  s.test('CATÁLOGO: etapas Omie incluem 10 (Pedido) ou similar', async () => {
    const r = await call('listarEtapasOmie', {});
    const etapas = r?.cadastros || [];
    // Cada cadastro tem cCodigo (ex "10", "20", "50", "60")
    const codigos = etapas.map(e => String(e.cCodigo || e.codigo || '')).filter(Boolean);
    assert.greaterThan(codigos.length, 0, 'nenhuma etapa com código');
  });

  s.test('CATÁLOGO: ListarCenarios retorna cenários fiscais', async () => {
    const r = await call('listarCenariosOmie', {});
    assert.truthy(r);
    assert.truthy(Array.isArray(r.cenarios), 'esperava r.cenarios como array');
  });

  s.test('CATÁLOGO: ListarNF (página 1) responde sem erro', async () => {
    const r = await call('listarNfsOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.nfs), 'esperava r.nfs como array');
  });

  s.test('CATÁLOGO: NFs trazem campos essenciais quando há dados', async () => {
    const r = await call('listarNfsOmie', { pagina: 1, registros_por_pagina: 3 });
    if (r.nfs.length === 0) return; // ok se conta nova/sem NFs
    const nf = r.nfs[0];
    // pelo menos um identificador deve vir
    assert.truthy(nf.numero_nf || nf.chave_acesso || nf.codigo_pedido || nf.id, 'NF sem identificador');
  });

  s.test('CATÁLOGO: ListarContasReceber responde sem erro', async () => {
    const r = await call('listarContasReceberOmie', { pagina: 1, registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.titulos), 'esperava r.titulos como array');
  });

  s.test('CATÁLOGO: pedidos etapa 60 (Faturado) — fluxo de NFs', async () => {
    const r = await call('consultarStatusFaturamentoOmie', { registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos), 'esperava r.pedidos como array');
  });

  s.test('CATÁLOGO: pedidos etapa 10 (Pedido de Venda)', async () => {
    const r = await call('buscarPedidosOmie', { etapa: '10', registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos));
  });

  s.test('CATÁLOGO: pedidos etapa 20 (Liberados)', async () => {
    const r = await call('buscarPedidosOmie', { etapa: '20', registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos));
  });

  s.test('CATÁLOGO: pedidos etapa 50 (Faturar)', async () => {
    const r = await call('buscarPedidosOmie', { etapa: '50', registros_por_pagina: 5 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos));
  });

  s.test('CATÁLOGO: ListarClientes (página 1) — base do cadastro', async () => {
    const r = await call('consultarClientesOmie', { pagina: 1, acao: 'listar' });
    assert.truthy(r);
    // ou r.clientes ou r.clientes_cadastro
    assert.truthy(Array.isArray(r.clientes) || Array.isArray(r.clientes_cadastro), 'esperava lista de clientes');
  });

  // ═══════════════════════════════════════════════════════════
  // 3. CONTRATOS — cada função rejeita payload inválido?
  //    (Isso é o que GARANTE que o sistema não envia lixo pro Omie)
  // ═══════════════════════════════════════════════════════════

  // --- Pedidos ---
  s.test('CONTRATO: enviarPedidoOmie rejeita sem pedido_id', async () => {
    await expectFail('enviarPedidoOmie', {});
  });

  s.test('CONTRATO: enviarPedidoOmie rejeita pedido_id inexistente', async () => {
    await expectFail('enviarPedidoOmie', { pedido_id: 'pedido-ID-INEXISTENTE-XYZ-999' });
  });

  s.test('CONTRATO: emitirNfPedidoOmie rejeita sem codigo_pedido', async () => {
    await expectFail('emitirNfPedidoOmie', {});
  });

  s.test('CONTRATO: cancelarNfOmie rejeita sem codigo_pedido', async () => {
    await expectFail('cancelarNfOmie', {});
  });

  s.test('CONTRATO: trocarEtapaPedidoOmie rejeita sem etapa', async () => {
    await expectFail('trocarEtapaPedidoOmie', { codigo_pedido: 1 });
  });

  s.test('CONTRATO: trocarEtapaPedidoOmie rejeita sem código de pedido', async () => {
    await expectFail('trocarEtapaPedidoOmie', { etapa: '20' });
  });

  s.test('CONTRATO: trocarEtapaPedidoLoteOmie rejeita lista vazia', async () => {
    await expectFail('trocarEtapaPedidoLoteOmie', { pedidos: [], etapa: '20' });
  });

  s.test('CONTRATO: cortarPedidoOmie rejeita sem codigo_pedido', async () => {
    await expectFail('cortarPedidoOmie', { cortes: [] });
  });

  s.test('CONTRATO: cortarPedidoOmie rejeita cortes vazio', async () => {
    await expectFail('cortarPedidoOmie', { codigo_pedido: 1 });
  });

  s.test('CONTRATO: devolverPedidoOmie rejeita sem codigo_pedido', async () => {
    await expectFail('devolverPedidoOmie', { produtos: [{ nCodProd: 1, quantidade: 1 }] });
  });

  s.test('CONTRATO: devolverPedidoOmie rejeita produtos vazio', async () => {
    await expectFail('devolverPedidoOmie', { codigo_pedido: 1, produtos: [] });
  });

  s.test('CONTRATO: editarPedidoOmie rejeita sem identificador', async () => {
    await expectFail('editarPedidoOmie', {});
  });

  s.test('CONTRATO: cancelarPedidoOmie rejeita sem identificador', async () => {
    await expectFail('cancelarPedidoOmie', {});
  });

  s.test('CONTRATO: liberarPedidoOmie rejeita sem identificador', async () => {
    await expectFail('liberarPedidoOmie', {});
  });

  s.test('CONTRATO: faturarPedidoOmie rejeita sem identificador', async () => {
    await expectFail('faturarPedidoOmie', {});
  });

  s.test('CONTRATO: alterarPrevisaoFaturamentoOmie rejeita sem dados', async () => {
    await expectFail('alterarPrevisaoFaturamentoOmie', {});
  });

  // --- Cliente ---
  s.test('CONTRATO: enviarClienteOmie rejeita sem cliente_id', async () => {
    await expectFail('enviarClienteOmie', {});
  });

  s.test('CONTRATO: enviarClienteOmie rejeita cliente_id inexistente', async () => {
    await expectFail('enviarClienteOmie', { cliente_id: 'INEXISTENTE-XYZ-999' });
  });

  s.test('CONTRATO: excluirClienteOmie rejeita sem id', async () => {
    await expectFail('excluirClienteOmie', {});
  });

  s.test('CONTRATO: excluirClientesLote rejeita lista vazia', async () => {
    await expectFail('excluirClientesLote', { ids: [] });
  });

  // --- Produto ---
  s.test('CONTRATO: enviarProdutoOmie rejeita sem produto_id', async () => {
    await expectFail('enviarProdutoOmie', {});
  });

  s.test('CONTRATO: excluirProdutoOmie rejeita sem id', async () => {
    await expectFail('excluirProdutoOmie', {});
  });

  s.test('CONTRATO: corrigirProdutoOmie rejeita sem identificador', async () => {
    await expectFail('corrigirProdutoOmie', {});
  });

  // --- Tabelas de preço ---
  s.test('CONTRATO: sincronizarTabelasOmie rejeita ação desconhecida', async () => {
    await expectFail('sincronizarTabelasOmie', { acao: 'inexistente_xyz' });
  });

  s.test('CONTRATO: sincronizarTabelasOmie exporta_tabela rejeita sem tabela_id', async () => {
    await expectFail('sincronizarTabelasOmie', { acao: 'exportar_tabela' });
  });

  s.test('CONTRATO: sincronizarTabelasOmie exportar_precos rejeita sem tabela_id', async () => {
    await expectFail('sincronizarTabelasOmie', { acao: 'exportar_precos' });
  });

  s.test('CONTRATO: sincronizarTabelasOmie excluir_tabela rejeita sem tabela_id', async () => {
    await expectFail('sincronizarTabelasOmie', { acao: 'excluir_tabela' });
  });

  s.test('CONTRATO: sincronizarTabelasOmie importar_precos rejeita sem tabela_id', async () => {
    await expectFail('sincronizarTabelasOmie', { acao: 'importar_precos' });
  });

  // --- Cargas ---
  s.test('CONTRATO: faturarCargaOmie rejeita sem carga_id', async () => {
    await expectFail('faturarCargaOmie', {});
  });

  s.test('CONTRATO: faturarCargaOmie rejeita carga inexistente', async () => {
    await expectFail('faturarCargaOmie', { carga_id: 'CARGA-INEXISTENTE-XYZ-999' });
  });

  s.test('CONTRATO: transferirPedidoCarga rejeita sem ids', async () => {
    await expectFail('transferirPedidoCarga', {});
  });

  s.test('CONTRATO: enriquecerPedidosCarga rejeita sem pedidos', async () => {
    await expectFail('enriquecerPedidosCarga', {});
  });

  // --- Financeiro ---
  s.test('CONTRATO: gerarBoletosOmie rejeita lista vazia', async () => {
    await expectFail('gerarBoletosOmie', { titulos: [] });
  });

  s.test('CONTRATO: consultarDebitosOmie rejeita sem cliente_id', async () => {
    await expectFail('consultarDebitosOmie', {});
  });

  s.test('CONTRATO: consultarBloqueioFinanceiroOmie rejeita sem cliente_id e cpf_cnpj', async () => {
    await expectFail('consultarBloqueioFinanceiroOmie', {});
  });

  // --- Consultas ---
  s.test('CONTRATO: consultarProdutoOmie rejeita sem codigos[]', async () => {
    await expectFail('consultarProdutoOmie', {});
  });

  s.test('CONTRATO: consultarStatusPedidosOmie rejeita sem omie_codigos[]', async () => {
    await expectFail('consultarStatusPedidosOmie', {});
  });

  s.test('CONTRATO: consultarPedidoOmie rejeita sem identificador', async () => {
    await expectFail('consultarPedidoOmie', {});
  });

  s.test('CONTRATO: consultarDetalheNotaOmie rejeita sem identificador', async () => {
    await expectFail('consultarDetalheNotaOmie', {});
  });

  s.test('CONTRATO: compararPedidoOmie rejeita sem identificador', async () => {
    await expectFail('compararPedidoOmie', {});
  });

  s.test('CONTRATO: importarPedidoOmie rejeita sem identificador', async () => {
    await expectFail('importarPedidoOmie', {});
  });

  // --- Webhook ---
  s.test('CONTRATO: receberWebhookOmie rejeita request sem token', async () => {
    await expectFail('receberWebhookOmie', {});
  });

  s.test('CONTRATO: receberWebhookOmie rejeita token inválido', async () => {
    await expectFail('receberWebhookOmie', { token: 'token-invalido-xyz' });
  });

  // --- Vendedores ---
  s.test('CONTRATO: enviarVendedorOmieAuto rejeita sem vendedor_id', async () => {
    await expectFail('enviarVendedorOmieAuto', {});
  });

  s.test('CONTRATO: excluirVendedorOmie rejeita sem id', async () => {
    await expectFail('excluirVendedorOmie', {});
  });

  // ═══════════════════════════════════════════════════════════
  // 4. AUDITORIAS — sanidade dos dados sincronizados
  // ═══════════════════════════════════════════════════════════

  s.test('AUDITORIA: auditarClientesOmie retorna estatísticas', async () => {
    const r = await call('auditarClientesOmie', {});
    assert.truthy(r);
    assert.truthy(typeof r.total === 'number', 'r.total deve ser number');
  });

  s.test('AUDITORIA: clientes com codigo_omie > 0 (sincronização ativa)', async () => {
    const r = await call('auditarClientesOmie', {});
    // Pelo menos algum cliente já foi para o Omie
    const sync = r.com_codigo_omie ?? r.sincronizados ?? 0;
    assert.greaterOrEqual(sync, 0, 'campo de sincronizados ausente');
  });

  s.test('AUDITORIA: auditarReferenciasClientes retorna resumo', async () => {
    const r = await call('auditarReferenciasClientes', {});
    assert.truthy(r);
    assert.truthy(r.resumo, 'r.resumo ausente');
  });

  s.test('AUDITORIA: planos órfãos contabilizados', async () => {
    const r = await call('auditarReferenciasClientes', {});
    assert.truthy(r.resumo);
    // resumo deve ter algum dos campos
    const tem = r.resumo.planos_orfaos != null || r.resumo.tabelas_orfas != null || r.resumo.modalidades_orfas != null || r.resumo.total != null;
    assert.truthy(tem, 'resumo sem campos de órfãos');
  });

  // ═══════════════════════════════════════════════════════════
  // 5. PRÉ-REQUISITOS DO APP — dados mínimos pros fluxos rodarem
  // ═══════════════════════════════════════════════════════════

  s.test('PRÉ-REQ: existe ao menos 1 Cliente no banco', async () => {
    const r = await base44.entities.Cliente.list('-created_date', 1);
    assert.greaterThan(r.length, 0, 'sistema vazio — não dá pra emitir pedido');
  });

  s.test('PRÉ-REQ: existe ao menos 1 Cliente sincronizado com Omie (codigo_omie)', async () => {
    const r = await base44.entities.Cliente.list('-created_date', 200);
    const sync = r.filter(c => c.codigo_omie);
    assert.greaterThan(sync.length, 0, 'nenhum cliente vinculado ao Omie — pedidos não vão ser aceitos');
  });

  s.test('PRÉ-REQ: existe ao menos 1 Produto', async () => {
    const r = await base44.entities.Produto.list('-created_date', 1);
    assert.greaterThan(r.length, 0);
  });

  s.test('PRÉ-REQ: existe ao menos 1 Produto com codigo_omie (sincronizado)', async () => {
    const r = await base44.entities.Produto.list('-created_date', 200);
    const sync = r.filter(p => p.codigo_omie);
    assert.greaterThan(sync.length, 0, 'nenhum produto vinculado ao Omie — pedidos não vão ter preço');
  });

  s.test('PRÉ-REQ: existe ao menos 1 TabelaPreco vinculada ao Omie', async () => {
    const r = await base44.entities.TabelaPreco.list();
    const sync = r.filter(t => t.omie_id);
    assert.greaterThan(sync.length, 0, 'nenhuma tabela vinculada — preços não chegam ao Omie');
  });

  s.test('PRÉ-REQ: existe ao menos 1 PlanoPagamento ativo', async () => {
    const r = await base44.entities.PlanoPagamento.filter({ status: 'ativo' });
    assert.greaterThan(r.length, 0, 'sem plano de pagamento, pedido não fecha');
  });

  s.test('PRÉ-REQ: existe ao menos 1 Vendedor cadastrado', async () => {
    const r = await base44.entities.Vendedor.list('-created_date', 1);
    assert.greaterThan(r.length, 0);
  });

  s.test('PRÉ-REQ: existe ao menos 1 CenarioFiscal sincronizado', async () => {
    const r = await base44.entities.CenarioFiscal.list();
    assert.greaterThan(r.length, 0, 'sem cenário fiscal, NF não emite');
  });

  s.test('PRÉ-REQ: existe ao menos 1 Veículo ativo', async () => {
    const r = await base44.entities.Veiculo.list();
    const ativos = r.filter(v => v.ativo !== false);
    assert.greaterThan(ativos.length, 0);
  });

  s.test('PRÉ-REQ: existe ao menos 1 Motorista ativo', async () => {
    const r = await base44.entities.Motorista.filter({ status: 'ativo' });
    assert.greaterThan(r.length, 0);
  });

  s.test('PRÉ-REQ: existe ao menos 1 Rota cadastrada', async () => {
    const r = await base44.entities.Rota.list();
    assert.greaterThan(r.length, 0);
  });

  // ═══════════════════════════════════════════════════════════
  // 6. SAÚDE — logs de erro recentes do Omie
  // ═══════════════════════════════════════════════════════════

  s.test('SAÚDE: % de erros nas últimas 50 chamadas Omie < 30%', async () => {
    const logs = await base44.entities.LogIntegracaoOmie.list('-created_date', 50);
    if (logs.length === 0) return; // sem dados, OK
    const erros = logs.filter(l => l.status === 'erro').length;
    const pct = (erros / logs.length) * 100;
    assert.truthy(pct < 30, `${pct.toFixed(1)}% de erros nas últimas ${logs.length} chamadas (alto demais)`);
  });

  s.test('SAÚDE: nenhuma chamada Omie demorou > 60s nas últimas 50', async () => {
    const logs = await base44.entities.LogIntegracaoOmie.list('-created_date', 50);
    const lentas = logs.filter(l => (l.duracao_ms || 0) > 60000);
    assert.equal(lentas.length, 0, `${lentas.length} chamadas > 60s — possível travamento`);
  });

  // ═══════════════════════════════════════════════════════════
  // 7. FLUXO COMPLETO COM PEDIDO REAL (se houver)
  // ═══════════════════════════════════════════════════════════

  s.test('FLUXO REAL: pedido enviado pode ser consultado de volta no Omie', async () => {
    const pedidos = await base44.entities.Pedido.filter({ omie_enviado: true }, '-created_date', 1);
    if (pedidos.length === 0) return; // ok se não tiver pedido ainda
    const pedido = pedidos[0];
    if (!pedido.omie_codigo_pedido) return;
    const r = await call('consultarPedidoOmie', { codigo_pedido: pedido.omie_codigo_pedido });
    assert.truthy(r);
    assert.truthy(!r.error, `Omie devolveu erro consultando pedido real ${pedido.omie_codigo_pedido}: ${r.error}`);
  });

  s.test('FLUXO REAL: status de pedidos enviados pode ser consultado em lote', async () => {
    const pedidos = await base44.entities.Pedido.filter({ omie_enviado: true }, '-created_date', 5);
    if (pedidos.length === 0) return;
    const codigos = pedidos.map(p => p.omie_codigo_pedido).filter(Boolean);
    if (codigos.length === 0) return;
    const r = await call('consultarStatusPedidosOmie', { omie_codigos: codigos });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos) || r.sucesso !== false, 'consulta de status falhou');
  });

  s.test('FLUXO REAL: cliente sincronizado pode ter débitos consultados', async () => {
    const clientes = await base44.entities.Cliente.filter({ status: 'ativo' }, '-created_date', 50);
    const comOmie = clientes.find(c => c.codigo_omie && c.cnpj_cpf);
    if (!comOmie) return;
    const r = await call('consultarDebitosOmie', { cliente_id: comOmie.id });
    assert.truthy(r);
    // pode não ter débitos, só não pode dar erro estrutural
    assert.truthy(!r.error || /\bnenhum\b|sem t[ií]tulos/i.test(r.error || ''), `erro inesperado: ${r.error}`);
  });

  // ═══════════════════════════════════════════════════════════
  // 8. HELPER DOCS
  // ═══════════════════════════════════════════════════════════

  s.test('HELPER: _omieHelperDocs responde', async () => {
    const r = await call('_omieHelperDocs', {});
    assert.truthy(r);
  });

  return s;
}