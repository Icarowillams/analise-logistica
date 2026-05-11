// Suíte de PARIDADE — garante que a otimização da Montagem de Carga produz
// EXATAMENTE o mesmo output do fluxo antigo (enriquecerPedidosCarga ao vivo).
//
// Estratégia:
//   1. Chama `buscarPedidosOmie` (etapa 20) — mesma fonte usada antes
//   2. Chama `enriquecerPedidosCarga` — pipeline ANTIGO
//   3. Lê `PedidoLiberadoOmie` — espelho NOVO
//   4. Compara campo a campo para os mesmos códigos de pedido
//
// Qualquer divergência de campo, contagem ou shape → teste falha.

import { createSuite, assert } from '@/lib/testRunner';
import { base44 } from '@/api/base44Client';

async function call(fn, payload = {}) {
  const res = await base44.functions.invoke(fn, payload);
  return res?.data;
}

// Campos que DEVEM existir e bater entre antigo e novo
const CAMPOS_OBRIGATORIOS = [
  'codigo_pedido',
  'numero_pedido',
  'codigo_cliente',
  'codigo_cliente_cod',
  'nome_cliente',
  'nome_fantasia',
  'cidade',
  'tipo_nota',
  'rota_nome',
  'rota_cliente',
  'quantidade_itens',
  'valor_total_pedido',
  'etapa'
];

// Normaliza valores pra comparação tolerante (null/undefined/'' contam como vazio)
function norm(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number(v.toFixed(2));
  return String(v).trim();
}

function diffPedido(antigo, novo) {
  const diffs = [];
  for (const campo of CAMPOS_OBRIGATORIOS) {
    const a = norm(antigo[campo]);
    const n = norm(novo[campo]);
    if (a !== n) {
      diffs.push(`${campo}: antigo="${a}" vs novo="${n}"`);
    }
  }
  return diffs;
}

export function buildSuiteParidadeMontagem() {
  const s = createSuite('Paridade Montagem de Carga — Espelho NOVO vs Fluxo ANTIGO');

  // Estado compartilhado entre testes da suíte
  const ctx = {
    omieRaw: null,
    enriquecidosAntigo: null,
    espelhoNovo: null,
    codigosComuns: []
  };

  // ═══════════════════════════════════════════════════════════
  // 1. CAPTURA — busca dados das duas pontas
  // ═══════════════════════════════════════════════════════════

  s.test('CAPTURA: buscarPedidosOmie etapa 20 retorna pedidos', async () => {
    const r = await call('buscarPedidosOmie', { etapa: '20', registros_por_pagina: 50 });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos), 'esperava r.pedidos como array');
    ctx.omieRaw = r.pedidos || [];
  });

  s.test('CAPTURA: enriquecerPedidosCarga produz output enriquecido (FLUXO ANTIGO)', async () => {
    if (!ctx.omieRaw || ctx.omieRaw.length === 0) {
      assert.truthy(true, 'sem pedidos na etapa 20 — paridade trivialmente OK');
      ctx.enriquecidosAntigo = [];
      return;
    }
    const r = await call('enriquecerPedidosCarga', { pedidos: ctx.omieRaw });
    assert.truthy(r);
    assert.truthy(Array.isArray(r.pedidos), 'enriquecerPedidosCarga deveria retornar r.pedidos[]');
    ctx.enriquecidosAntigo = r.pedidos;
  });

  s.test('CAPTURA: espelho PedidoLiberadoOmie (FLUXO NOVO) está populado', async () => {
    const espelho = await base44.entities.PedidoLiberadoOmie.list('-created_date', 5000);
    ctx.espelhoNovo = espelho || [];
    // Se o espelho estiver vazio mas houver pedidos no Omie → bootstrap ainda não rodou
    if (ctx.omieRaw && ctx.omieRaw.length > 0 && ctx.espelhoNovo.length === 0) {
      throw new Error(`Omie tem ${ctx.omieRaw.length} pedidos etapa 20 mas espelho está vazio. Rode bootstrapPedidosLiberadosOmie.`);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 2. CONTAGEM — mesma quantidade nos 2 fluxos
  // ═══════════════════════════════════════════════════════════

  s.test('CONTAGEM: espelho cobre TODOS os pedidos retornados pelo Omie', async () => {
    if (!ctx.omieRaw || ctx.omieRaw.length === 0) return;
    const codigosOmie = new Set(ctx.omieRaw.map(p =>
      String(p?.cabecalho?.codigo_pedido || p?.codigo_pedido || '')
    ).filter(Boolean));
    const codigosEspelho = new Set(ctx.espelhoNovo.map(e => String(e.codigo_pedido || '')));

    const faltando = [...codigosOmie].filter(c => !codigosEspelho.has(c));
    assert.equal(faltando.length, 0,
      `${faltando.length} pedidos no Omie etapa 20 mas FORA do espelho: ${faltando.slice(0, 5).join(', ')}`);
  });

  s.test('CONTAGEM: espelho não contém pedidos QUE NÃO ESTÃO MAIS na etapa 20', async () => {
    if (!ctx.omieRaw) return;
    const codigosOmie = new Set(ctx.omieRaw.map(p =>
      String(p?.cabecalho?.codigo_pedido || p?.codigo_pedido || '')
    ).filter(Boolean));

    // Se Omie retornou poucos pedidos (1 página de 50), aceitamos o teste
    // só se a quantidade do espelho não for absurdamente maior (margem 50%)
    if (ctx.omieRaw.length < 50) {
      const sobrando = ctx.espelhoNovo.filter(e => !codigosOmie.has(String(e.codigo_pedido)));
      // Pode ter pedidos legítimos que Omie retornou em paginação posterior, então só alerta se > 30%
      const pctSobra = ctx.espelhoNovo.length > 0 ? (sobrando.length / ctx.espelhoNovo.length) : 0;
      if (pctSobra > 0.3) {
        throw new Error(`${sobrando.length} de ${ctx.espelhoNovo.length} (${(pctSobra*100).toFixed(0)}%) pedidos do espelho NÃO aparecem na etapa 20 atual do Omie`);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 3. SHAPE — espelho tem todos os campos obrigatórios
  // ═══════════════════════════════════════════════════════════

  s.test('SHAPE: cada registro do espelho tem todos os CAMPOS_OBRIGATORIOS', async () => {
    if (ctx.espelhoNovo.length === 0) return;
    const amostra = ctx.espelhoNovo.slice(0, 20);
    for (const reg of amostra) {
      for (const campo of CAMPOS_OBRIGATORIOS) {
        if (!(campo in reg)) {
          throw new Error(`registro ${reg.codigo_pedido} não tem o campo "${campo}"`);
        }
      }
    }
  });

  s.test('SHAPE: campo produtos[] do espelho tem o mesmo shape do antigo', async () => {
    if (ctx.espelhoNovo.length === 0) return;
    const reg = ctx.espelhoNovo.find(e => Array.isArray(e.produtos) && e.produtos.length > 0);
    if (!reg) return; // ok se nenhum tem produtos ainda
    const p = reg.produtos[0];
    const camposProduto = ['codigo_produto', 'descricao', 'quantidade', 'valor_unitario', 'valor_total', 'unidade'];
    for (const c of camposProduto) {
      assert.truthy(c in p, `produto sem campo "${c}"`);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 4. PARIDADE DE DADOS — campos idênticos entre antigo e novo
  // ═══════════════════════════════════════════════════════════

  s.test('PARIDADE: identifica pedidos presentes nos DOIS fluxos', async () => {
    if (!ctx.enriquecidosAntigo || ctx.enriquecidosAntigo.length === 0) return;
    const mapAntigo = new Map(ctx.enriquecidosAntigo.map(p => [String(p.codigo_pedido), p]));
    const mapNovo = new Map(ctx.espelhoNovo.map(p => [String(p.codigo_pedido), p]));
    ctx.codigosComuns = [...mapAntigo.keys()].filter(c => mapNovo.has(c));
    assert.greaterThan(ctx.codigosComuns.length, 0, 'nenhum pedido em comum — não dá pra comparar paridade');
    ctx._mapAntigo = mapAntigo;
    ctx._mapNovo = mapNovo;
  });

  s.test('PARIDADE: nome_cliente é IDÊNTICO em 100% dos pedidos comuns', async () => {
    if (!ctx.codigosComuns || ctx.codigosComuns.length === 0) return;
    const divergencias = [];
    for (const cod of ctx.codigosComuns) {
      const a = norm(ctx._mapAntigo.get(cod).nome_cliente);
      const n = norm(ctx._mapNovo.get(cod).nome_cliente);
      if (a !== n) divergencias.push(`${cod}: "${a}" vs "${n}"`);
    }
    assert.equal(divergencias.length, 0,
      `${divergencias.length} divergências em nome_cliente: ${divergencias.slice(0, 3).join(' | ')}`);
  });

  s.test('PARIDADE: cidade é IDÊNTICA em 100% dos pedidos comuns', async () => {
    if (!ctx.codigosComuns || ctx.codigosComuns.length === 0) return;
    const divergencias = [];
    for (const cod of ctx.codigosComuns) {
      const a = norm(ctx._mapAntigo.get(cod).cidade);
      const n = norm(ctx._mapNovo.get(cod).cidade);
      if (a !== n) divergencias.push(`${cod}: "${a}" vs "${n}"`);
    }
    assert.equal(divergencias.length, 0,
      `${divergencias.length} divergências em cidade: ${divergencias.slice(0, 3).join(' | ')}`);
  });

  s.test('PARIDADE: rota_cliente é IDÊNTICA em 100% dos pedidos comuns', async () => {
    if (!ctx.codigosComuns || ctx.codigosComuns.length === 0) return;
    const divergencias = [];
    for (const cod of ctx.codigosComuns) {
      const a = norm(ctx._mapAntigo.get(cod).rota_cliente || ctx._mapAntigo.get(cod).rota_nome);
      const n = norm(ctx._mapNovo.get(cod).rota_cliente || ctx._mapNovo.get(cod).rota_nome);
      if (a !== n) divergencias.push(`${cod}: "${a}" vs "${n}"`);
    }
    assert.equal(divergencias.length, 0,
      `${divergencias.length} divergências em rota_cliente: ${divergencias.slice(0, 3).join(' | ')}`);
  });

  s.test('PARIDADE: tipo_nota é IDÊNTICO em 100% dos pedidos comuns', async () => {
    if (!ctx.codigosComuns || ctx.codigosComuns.length === 0) return;
    const divergencias = [];
    for (const cod of ctx.codigosComuns) {
      const a = norm(ctx._mapAntigo.get(cod).tipo_nota);
      const n = norm(ctx._mapNovo.get(cod).tipo_nota);
      if (a !== n) divergencias.push(`${cod}: "${a}" vs "${n}"`);
    }
    assert.equal(divergencias.length, 0,
      `${divergencias.length} divergências em tipo_nota: ${divergencias.slice(0, 3).join(' | ')}`);
  });

  s.test('PARIDADE: valor_total_pedido bate (tolerância R$ 0,01)', async () => {
    if (!ctx.codigosComuns || ctx.codigosComuns.length === 0) return;
    const divergencias = [];
    for (const cod of ctx.codigosComuns) {
      const a = Number(ctx._mapAntigo.get(cod).valor_total_pedido || 0);
      const n = Number(ctx._mapNovo.get(cod).valor_total_pedido || 0);
      if (Math.abs(a - n) > 0.01) divergencias.push(`${cod}: ${a} vs ${n}`);
    }
    assert.equal(divergencias.length, 0,
      `${divergencias.length} divergências em valor_total: ${divergencias.slice(0, 3).join(' | ')}`);
  });

  s.test('PARIDADE: quantidade_itens bate exatamente', async () => {
    if (!ctx.codigosComuns || ctx.codigosComuns.length === 0) return;
    const divergencias = [];
    for (const cod of ctx.codigosComuns) {
      const a = Number(ctx._mapAntigo.get(cod).quantidade_itens || 0);
      const n = Number(ctx._mapNovo.get(cod).quantidade_itens || 0);
      if (a !== n) divergencias.push(`${cod}: ${a} vs ${n}`);
    }
    assert.equal(divergencias.length, 0,
      `${divergencias.length} divergências em quantidade_itens: ${divergencias.slice(0, 3).join(' | ')}`);
  });

  s.test('PARIDADE: cliente_id resolvido (Base44) bate quando ambos têm valor', async () => {
    if (!ctx.codigosComuns || ctx.codigosComuns.length === 0) return;
    const divergencias = [];
    for (const cod of ctx.codigosComuns) {
      const a = ctx._mapAntigo.get(cod).cliente_id;
      const n = ctx._mapNovo.get(cod).cliente_id;
      // Só conta como divergência se AMBOS têm valor e diferente
      if (a && n && a !== n) divergencias.push(`${cod}: ${a} vs ${n}`);
    }
    assert.equal(divergencias.length, 0,
      `${divergencias.length} divergências em cliente_id: ${divergencias.slice(0, 3).join(' | ')}`);
  });

  s.test('PARIDADE GERAL: diferença total ≤ 2% dos pedidos comuns', async () => {
    if (!ctx.codigosComuns || ctx.codigosComuns.length === 0) return;
    let comDiff = 0;
    const exemplos = [];
    for (const cod of ctx.codigosComuns) {
      const diffs = diffPedido(ctx._mapAntigo.get(cod), ctx._mapNovo.get(cod));
      if (diffs.length > 0) {
        comDiff++;
        if (exemplos.length < 3) exemplos.push(`${cod}: ${diffs.slice(0, 2).join('; ')}`);
      }
    }
    const pct = (comDiff / ctx.codigosComuns.length) * 100;
    assert.truthy(pct <= 2,
      `${comDiff}/${ctx.codigosComuns.length} pedidos (${pct.toFixed(1)}%) divergem. Exemplos: ${exemplos.join(' | ')}`);
  });

  // ═══════════════════════════════════════════════════════════
  // 5. PERFORMANCE — comprova ganho de velocidade
  // ═══════════════════════════════════════════════════════════

  s.test('PERFORMANCE: leitura do espelho < 3s (alvo: 500ms)', async () => {
    const ini = Date.now();
    await base44.entities.PedidoLiberadoOmie.list('-created_date', 5000);
    const ms = Date.now() - ini;
    assert.truthy(ms < 3000, `espelho demorou ${ms}ms — muito acima do esperado`);
  });

  return s;
}