import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      // Tratamento de status HTTP ANTES de res.json() — num 5xx/429 o corpo não costuma ser JSON.
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 425) {
          const _cbId = '6a1e06a9aa62ceab7b3b6d97';
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p: any = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

// ✅ ITEM 7
const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  return null;
}
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

// omieCall robusto: circuit breaker + 425 (bloqueio 30min, sem retry) + retry 429 + log padronizado.

async function localizarCargaDoPedido(base44, codigoPedidoOmie, isInterno, pedidoIdInterno) {
  try {
    // 🐛 FIX item3: busca direta O(1) via Pedido.carga_id em vez de varrer 400 cargas
    let cargaId = null;
    if (pedidoIdInterno) {
      const pedido = await base44.asServiceRole.entities.Pedido.get(pedidoIdInterno).catch(() => null);
      if (pedido?.carga_id) cargaId = pedido.carga_id;
    } else if (codigoPedidoOmie) {
      const pedidos = await base44.asServiceRole.entities.Pedido.filter(
        { omie_codigo_pedido: String(codigoPedidoOmie) }, '-created_date', 1
      ).catch(() => []);
      if (pedidos?.[0]?.carga_id) cargaId = pedidos[0].carga_id;
    }
    if (cargaId) {
      const carga = await base44.asServiceRole.entities.Carga.get(cargaId).catch(() => null);
      if (carga) {
        const arr = isInterno ? (carga.pedidos_internos || []) : (carga.pedidos_omie || []);
        const pedidoNaCarga = arr.find(p => isInterno
          ? String(p.pedido_id) === String(pedidoIdInterno)
          : String(p.codigo_pedido) === String(codigoPedidoOmie));
        if (pedidoNaCarga) return { id: carga.id, numero: carga.numero_carga, pedidoNaCarga };
      }
    }
    // Fallback: varre apenas últimas 50 cargas (antes eram 400)
    console.warn('[cortarPedidoOmie] carga_id não achado no Pedido — fallback varredura 50 cargas');
    const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 50).catch(() => []);
    for (const carga of cargas) {
      const arr = isInterno ? (carga.pedidos_internos || []) : (carga.pedidos_omie || []);
      const pedidoNaCarga = arr.find(p => isInterno
        ? String(p.pedido_id) === String(pedidoIdInterno)
        : String(p.codigo_pedido) === String(codigoPedidoOmie));
      if (pedidoNaCarga) return { id: carga.id, numero: carga.numero_carga, pedidoNaCarga };
    }
  } catch (_) {}
  return { id: null, numero: null, pedidoNaCarga: null };
}

// 🐛 FIX item3: refletirCorteNaCargaLocal — mesma correção O(N)→O(1)
async function refletirCorteNaCargaLocal(base44, codigoPedidoOmie, cortes, isInterno, pedidoIdInterno) {
  try {
    let cargaId = null;
    if (pedidoIdInterno) {
      const ped = await base44.asServiceRole.entities.Pedido.get(pedidoIdInterno).catch(() => null);
      if (ped?.carga_id) cargaId = ped.carga_id;
    } else if (codigoPedidoOmie) {
      const peds = await base44.asServiceRole.entities.Pedido.filter(
        { omie_codigo_pedido: String(codigoPedidoOmie) }, '-created_date', 1
      ).catch(() => []);
      if (peds?.[0]?.carga_id) cargaId = peds[0].carga_id;
    }
    const cargas = cargaId
      ? [await base44.asServiceRole.entities.Carga.get(cargaId).catch(() => null)].filter(Boolean)
      : await base44.asServiceRole.entities.Carga.list('-created_date', 50).catch(() => []);
    for (const carga of cargas) {

      let modificou = false;
      let pedidosArray = isInterno ? (carga.pedidos_internos || []) : (carga.pedidos_omie || []);
      const novos = pedidosArray.map(ped => {
        const match = isInterno
          ? String(ped.pedido_id) === String(pedidoIdInterno)
          : String(ped.codigo_pedido) === String(codigoPedidoOmie);
        if (!match) return ped;

        const novosProdutos = (ped.produtos || []).map(pr => {
          const cod = String(pr.codigo_produto || pr.codigo_produto_integracao || '');
          const corte = cortes.find(c => String(c.codigo_produto) === cod);
          if (!corte) return pr;
          modificou = true;
          const novaQtd = Number(corte.nova_quantidade);
          if (novaQtd === 0) return null; // remover item
          return {
            ...pr,
            quantidade: novaQtd,
            valor_total: novaQtd * Number(pr.valor_unitario || 0)
          };
        }).filter(Boolean);

        // Recalcular totais do pedido
        const valorTotal = novosProdutos.reduce((s, p) => s + Number(p.valor_total || 0), 0);
        const qtdItens = novosProdutos.length;
        return { ...ped, produtos: novosProdutos, valor_total_pedido: valorTotal, quantidade_itens: qtdItens };
      });

      if (modificou) {
        // Recalcular totais da carga
        const todosProds = [
          ...(isInterno ? (carga.pedidos_omie || []) : novos),
          ...(isInterno ? novos : (carga.pedidos_internos || [])),
          ...(carga.pedidos_troca || [])
        ];
        const valorTotalCarga = todosProds.reduce((s, p) => s + Number(p.valor_total_pedido || 0), 0);

        const updateData = isInterno
          ? { pedidos_internos: novos, valor_total: valorTotalCarga, valor_total_carga: valorTotalCarga }
          : { pedidos_omie: novos, valor_total: valorTotalCarga, valor_total_carga: valorTotalCarga };

        await base44.asServiceRole.entities.Carga.update(carga.id, updateData);
        return carga.id;
      }
    }
  } catch (e) {
    console.error('[cortarPedidoOmie] Falha ao refletir corte na Carga local:', e.message);
  }
  return null;
}

// Corte em pedido D1 interno (sem Omie): atualiza apenas o Pedido + Carga local
async function cortarPedidoInterno(base44, pedido_id, cortes, motivo_geral, user) {
  const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
  if (!pedido) throw new Error('Pedido interno não encontrado');
  if (pedido.status === 'cancelado') throw new Error('Pedido cancelado: não permite corte');

  const cargaInfo = await localizarCargaDoPedido(base44, null, true, pedido_id);

  // Atualizar valor total do pedido — itens reais ficam no PedidoItem
  const itens = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });
  const logs = [];
  let novoTotal = 0;

  for (const item of itens) {
    const corte = cortes.find(c => String(c.codigo_produto) === String(item.produto_codigo || item.codigo_produto));
    if (!corte) {
      novoTotal += Number(item.valor_total || 0);
      continue;
    }
    const qOrig = Number(item.quantidade || 0);
    const qNova = Number(corte.nova_quantidade);
    const valUnit = Number(item.valor_unitario || 0);

    logs.push({
      pedido_codigo_omie: '',
      numero_pedido: pedido.numero_pedido || '',
      cliente_id: pedido.cliente_id || '',
      cliente_codigo: String(pedido.cliente_codigo || ''),
      cliente_nome: pedido.cliente_nome || pedido.cliente_nome_fantasia || '',
      cnpj_cpf_cliente: pedido.cliente_cpf_cnpj || '',
      carga_id: cargaInfo.id || pedido.carga_id || null,
      carga_numero: cargaInfo.numero || pedido.numero_carga || null,
      produto_codigo: String(item.produto_codigo || ''),
      produto_descricao: item.produto_descricao || item.descricao || '',
      quantidade_anterior: qOrig,
      quantidade_nova: qNova,
      quantidade_cortada: qOrig - qNova,
      valor_unitario: valUnit,
      valor_anterior: qOrig * valUnit,
      valor_novo: qNova * valUnit,
      valor_cortado: (qOrig - qNova) * valUnit,
      motivo: corte.motivo || motivo_geral,
      tipo_operacao: qNova === 0 ? 'remocao_item' : 'corte_quantidade',
      funcionario_nome: user.full_name || user.email,
      sincronizado_omie: false,
      origem_pedido: 'interno_d1'
    });

    if (qNova === 0) {
      await base44.asServiceRole.entities.PedidoItem.delete(item.id);
    } else {
      await base44.asServiceRole.entities.PedidoItem.update(item.id, {
        quantidade: qNova,
        valor_total: qNova * valUnit
      });
      novoTotal += qNova * valUnit;
    }
  }

  await base44.asServiceRole.entities.Pedido.update(pedido_id, { valor_total: novoTotal });

  // Refletir na Carga local também
  await refletirCorteNaCargaLocal(base44, null, cortes, true, pedido_id);

  for (const log of logs) {
    await base44.asServiceRole.entities.LogCorte.create(log).catch(() => {});
  }

  return logs;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, pedido_id_interno, cortes = [], motivo_geral = '' } = body;
    if (cortes.length === 0) return Response.json({ error: 'cortes vazio' }, { status: 400 });

    // === FLUXO PEDIDO INTERNO (D1) ===
    if (pedido_id_interno && !codigo_pedido) {
      const logs = await cortarPedidoInterno(base44, pedido_id_interno, cortes, motivo_geral, user);
      return Response.json({ sucesso: true, itens_alterados: logs.length, logs, origem: 'interno' });
    }

    // === FLUXO PEDIDO OMIE ===
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });

    const consulta = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigo_pedido) }, { call: 'ConsultarPedido', cacheMinutes: 0 });
    const pedido = consulta.pedido_venda_produto;
    if (!pedido) return Response.json({ error: 'Pedido não encontrado no Omie' }, { status: 404 });

    const cargaInfo = await localizarCargaDoPedido(base44, codigo_pedido, false, null);

    // Tenta resolver o cliente local pelo CNPJ/CPF para enriquecer o log
    let clienteLocal = null;
    try {
      const cnpj = String(pedido.cliente?.cnpj_cpf || '').replace(/\D/g, '');
      if (cnpj) {
        const lista = await base44.asServiceRole.entities.Cliente.filter({ cnpj_cpf: cnpj }, '-created_date', 1);
        clienteLocal = lista?.[0] || null;
      }
    } catch (_) {}

    // Detecção precisa de cancelamento (NÃO usa JSON.stringify — pegaria histórico)
    const flagCancelado = pedido?.infoCadastro?.cancelado;
    const etapaAtual = String(pedido?.cabecalho?.etapa || '');
    if (flagCancelado === 'S' || etapaAtual === '99' || etapaAtual.toLowerCase().includes('cancelado')) {
      return Response.json({ error: 'Pedido cancelado: não é permitido editar ou ajustar.' }, { status: 400 });
    }

    // Regra de negócio: só pode cortar pedidos nas etapas 10 (Pedido), 20 (Liberados) ou 50 (Faturar / Montagem).
    // Etapa 60 (Faturado) já gerou NF — não pode mais ajustar.
    const ETAPAS_AJUSTAVEIS = ['10', '20', '50'];
    const ETAPA_NOMES_MAP = { '10': 'Pedido de Venda', '20': 'Liberados (Pendente)', '50': 'Faturar (Montagem)', '60': 'Faturado', '70': 'Entrega' };
    if (!ETAPAS_AJUSTAVEIS.includes(etapaAtual)) {
      const nome = ETAPA_NOMES_MAP[etapaAtual] || `Etapa ${etapaAtual}`;
      return Response.json({
        error: `Não é possível cortar este pedido. Está na etapa "${nome}" (${etapaAtual}). Apenas pedidos Pendentes, Liberados ou em Montagem podem ser cortados.`,
        etapa_atual: etapaAtual,
        etapa_nome: nome
      }, { status: 400 });
    }

    const itensAtuais = pedido.det || [];
    const logs = [];

    const novosItens = [];
    for (const item of itensAtuais) {
      const codProdInt = item.produto?.codigo_produto_integracao;
      const codProd = item.produto?.codigo_produto;
      const corte = cortes.find(c =>
        String(c.codigo_produto) === String(codProd) ||
        String(c.codigo_produto) === String(codProdInt)
      );

      if (!corte) {
        novosItens.push({
          ide: {
            codigo_item_integracao: item.ide?.codigo_item_integracao || ''
          },
          produto: {
            codigo_produto: item.produto?.codigo_produto || '',
            codigo_produto_integracao: item.produto?.codigo_produto_integracao || '',
            descricao: item.produto?.descricao || '',
            quantidade: item.produto?.quantidade || 0,
            valor_unitario: item.produto?.valor_unitario || 0,
            unidade: item.produto?.unidade || 'UN'
          }
        });
        continue;
      }

      const qtdAnterior = item.produto?.quantidade || 0;
      const qtdNova = Number(corte.nova_quantidade);
      const valorUnit = item.produto?.valor_unitario || 0;

      const pedNaCarga = cargaInfo.pedidoNaCarga;
      logs.push({
        pedido_codigo_omie: String(codigo_pedido),
        numero_pedido: String(pedido.cabecalho?.numero_pedido || ''),
        cliente_id: clienteLocal?.id || '',
        cliente_codigo: String(clienteLocal?.codigo_interno || pedNaCarga?.codigo_cliente_cod || pedNaCarga?.codigo_cliente || pedido.cliente?.codigo_cliente_omie || ''),
        cliente_nome: clienteLocal?.razao_social || pedNaCarga?.nome_cliente || pedNaCarga?.nome_fantasia || pedido.cliente?.nome_cliente || '',
        cnpj_cpf_cliente: String(pedNaCarga?.cnpj_cpf_cliente || pedido.cliente?.cnpj_cpf || ''),
        carga_id: cargaInfo.id || null,
        carga_numero: cargaInfo.numero || null,
        produto_codigo: String(codProd || ''),
        produto_codigo_integracao: String(codProdInt || ''),
        produto_descricao: item.produto?.descricao || '',
        quantidade_anterior: qtdAnterior,
        quantidade_nova: qtdNova,
        quantidade_cortada: qtdAnterior - qtdNova,
        valor_unitario: valorUnit,
        valor_anterior: qtdAnterior * valorUnit,
        valor_novo: qtdNova * valorUnit,
        valor_cortado: (qtdAnterior - qtdNova) * valorUnit,
        motivo: corte.motivo || motivo_geral,
        tipo_operacao: qtdNova === 0 ? 'remocao_item' : 'corte_quantidade',
        funcionario_nome: user.full_name || user.email,
        origem_pedido: 'omie',
        sincronizado_omie: false
      });

      if (qtdNova > 0) {
        novosItens.push({
          ide: {
            codigo_item_integracao: item.ide?.codigo_item_integracao || ''
          },
          produto: {
            codigo_produto: item.produto?.codigo_produto || '',
            codigo_produto_integracao: item.produto?.codigo_produto_integracao || '',
            descricao: item.produto?.descricao || '',
            quantidade: qtdNova,
            valor_unitario: item.produto?.valor_unitario || 0,
            unidade: item.produto?.unidade || 'UN'
          }
        });
      }
    }

    // 🐛 FIX 2: codigo_pedido_integracao — gerar fallback se vazio (pedidos manuais do Omie não têm)
    const codigoPedidoIntegracao = String(pedido.cabecalho?.codigo_pedido_integracao || '').trim();
    const codigoPedidoIntegracaoFinal = codigoPedidoIntegracao || `PED-${codigo_pedido}`;

    // 🐛 FIX 3: codigo_cliente — garantir que é numérico (Omie exige Number).
    // Se vier como ObjectId do Base44 (string hex), resolver via cliente local ou usar codigo_cliente do Omie.
    let codigoClienteOmie = pedido.cabecalho?.codigo_cliente;
    if (!codigoClienteOmie || isNaN(Number(codigoClienteOmie)) || Number(codigoClienteOmie) === 0) {
      // Tentar resolver pelo cliente local (já buscado acima por CNPJ)
      const codigoFallback = clienteLocal?.codigo_omie || clienteLocal?.codigo_cliente_omie || clienteLocal?.codigo_interno;
      if (codigoFallback && !isNaN(Number(codigoFallback)) && Number(codigoFallback) > 0) {
        codigoClienteOmie = Number(codigoFallback);
        console.log(`[cortarPedidoOmie] codigo_cliente resolvido via cliente local: ${codigoClienteOmie}`);
      } else {
        // Último recurso: buscar pelo codigo_integracao do pedido via API Omie
        console.warn(`[cortarPedidoOmie] codigo_cliente inválido: ${pedido.cabecalho?.codigo_cliente} — tentando usar codigo_cliente_integracao`);
        codigoClienteOmie = 0; // Omie usará o codigo_cliente_integracao como fallback
      }
    } else {
      codigoClienteOmie = Number(codigoClienteOmie);
    }

    let erroOmie = null;
    try {
      await omieCall(base44, 'produtos/pedido/', {
        cabecalho: {
          codigo_pedido: Number(codigo_pedido),
          codigo_pedido_integracao: codigoPedidoIntegracaoFinal,
          codigo_cliente: codigoClienteOmie,
          codigo_cliente_integracao: String(pedido.cabecalho?.codigo_cliente_integracao || clienteLocal?.codigo_integracao || clienteLocal?.id || ''),
          etapa: pedido.cabecalho?.etapa || '10'
        },
        det: novosItens
      }, { call: 'AlterarPedidoVenda', cacheMinutes: 0 });
    } catch (err) {
      if (err.code === 'OMIE_425') throw err; // propaga bloqueio ao catch externo
      erroOmie = err.message;
    }

    for (const log of logs) {
      await base44.asServiceRole.entities.LogCorte.create({
        ...log,
        sincronizado_omie: !erroOmie,
        erro_omie: erroOmie
      }).catch(() => {});
    }

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'AlterarPedidoVenda',
      operacao: 'cortar_pedido',
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: erroOmie ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    if (erroOmie) return Response.json({ error: erroOmie }, { status: 500 });

    // Refletir corte na Carga local (espelho!)
    const cargaAtualizada = await refletirCorteNaCargaLocal(base44, codigo_pedido, cortes, false, null);

    // Sincronizar Pedido local, PedidoItem e PedidoLiberadoOmie após corte (100% LOCAL, sem reconsultar Omie)
    if (!erroOmie) {
      try {
        // 1) Buscar Pedido local pelo codigo_pedido Omie
        const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter(
          { omie_codigo_pedido: String(codigo_pedido) }, '-created_date', 1
        );
        const pedidoLocal = pedidosLocais?.[0];

        if (pedidoLocal) {
          // 2) Buscar PedidoItem locais
          const itensLocais = await base44.asServiceRole.entities.PedidoItem.filter(
            { pedido_id: pedidoLocal.id }
          );

          // 3) Buscar Produtos para resolver codigo_omie → produto_id
          //    Pegar apenas os produtos dos cortes para minimizar consulta
          // 🐛 FIX item3: era Produto.list(2000) para resolver 2-3 códigos — agora busca seletiva
          const codigosOmieDosCortes = [...new Set(cortes.map(c => String(c.codigo_produto)).filter(Boolean))];
          const omieParaProdutoId = new Map();
          await Promise.all(codigosOmieDosCortes.map(async (cod) => {
            const prods = await base44.asServiceRole.entities.Produto.filter(
              { codigo_omie: cod }, '-created_date', 1
            ).catch(() => []);
            if (prods?.[0]) omieParaProdutoId.set(cod, prods[0].id);
          }));

          // 4) Aplicar cortes nos PedidoItem
          for (const corte of cortes) {
            const codOmie = String(corte.codigo_produto);
            const produtoId = omieParaProdutoId.get(codOmie);
            const novaQtd = Number(corte.nova_quantidade);

            // Buscar PedidoItem por produto_id OU por produto_codigo (fallback)
            const itemLocal = itensLocais.find(il =>
              (produtoId && String(il.produto_id) === String(produtoId)) ||
              String(il.produto_codigo) === codOmie
            );

            if (!itemLocal) {
              console.warn(`[cortarPedidoOmie] PedidoItem não encontrado para codigo_omie=${codOmie}, produto_id=${produtoId}`);
              continue;
            }

            if (novaQtd === 0) {
              await base44.asServiceRole.entities.PedidoItem.delete(itemLocal.id);
            } else {
              const valUnit = Number(itemLocal.valor_unitario || 0);
              await base44.asServiceRole.entities.PedidoItem.update(itemLocal.id, {
                quantidade: novaQtd,
                valor_total: novaQtd * valUnit
              });
            }
          }

          // 5) Recalcular Pedido.valor_total a partir dos PedidoItem restantes
          const itensRestantes = await base44.asServiceRole.entities.PedidoItem.filter(
            { pedido_id: pedidoLocal.id }
          );
          const novoValorTotal = itensRestantes.reduce((s, il) => s + Number(il.valor_total || 0), 0);
          const novoTotalItens = itensRestantes.length;

          await base44.asServiceRole.entities.Pedido.update(pedidoLocal.id, {
            valor_total: novoValorTotal,
            total_itens: novoTotalItens
          });

          console.log(`[cortarPedidoOmie] Pedido local ${pedidoLocal.id} atualizado: valor_total=${novoValorTotal}, total_itens=${novoTotalItens}`);
        }

        // 6) Atualizar PedidoLiberadoOmie (espelho) usando novosItens já calculados
        const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
          { codigo_pedido: String(codigo_pedido) }, '-created_date', 1
        );
        if (espelhos.length > 0) {
          const novosProdutosEspelho = novosItens.map(d => ({
            codigo_produto: String(d.produto?.codigo_produto || ''),
            codigo_produto_integracao: String(d.produto?.codigo_produto_integracao || ''),
            descricao: d.produto?.descricao || '',
            quantidade: Number(d.produto?.quantidade || 0),
            valor_unitario: Number(d.produto?.valor_unitario || 0),
            valor_total: Number(d.produto?.quantidade || 0) * Number(d.produto?.valor_unitario || 0),
            unidade: d.produto?.unidade || 'UN'
          }));
          const valorEspelho = novosProdutosEspelho.reduce((s, p) => s + Number(p.valor_total || 0), 0);

          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
            valor_total_pedido: valorEspelho,
            quantidade_itens: novosItens.length,
            produtos: novosProdutosEspelho,
            sincronizado_em: new Date().toISOString()
          });
        }

        // Log de sincronização local bem-sucedida
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: 'produtos/pedido',
          call: 'LOCAL_SYNC',
          operacao: 'cortar_pedido_sincronizar_valores',
          entidade_tipo: 'Pedido',
          entidade_id: String(codigo_pedido),
          status: 'sucesso',
          mensagem_erro: `Corte aplicado localmente. Pedido/PedidoItem/Espelho atualizados sem reconsulta Omie. Fonte: LOCAL_DIRETO`,
          usuario_email: user.email
        }).catch(() => {});
      } catch (errSinc) {
        console.warn('[cortarPedidoOmie] Corte OK no Omie mas falhou ao sincronizar dados locais:', errSinc.message);
        // Log do erro para auditoria
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: 'produtos/pedido',
          call: 'LOCAL_SYNC',
          operacao: 'cortar_pedido_sincronizar_valores',
          entidade_tipo: 'Pedido',
          entidade_id: String(codigo_pedido),
          status: 'erro',
          mensagem_erro: `Erro na sincronização local pós-corte: ${errSinc.message}`,
          usuario_email: user.email
        }).catch(() => {});
      }
    }

    return Response.json({ sucesso: true, itens_alterados: logs.length, logs, carga_atualizada: cargaAtualizada });
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});