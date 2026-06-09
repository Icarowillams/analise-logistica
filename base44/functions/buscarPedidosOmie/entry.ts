import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache = null;

// ID fixo do único registro de circuit breaker — NUNCA criar novos
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

function extrairSegundosBloqueio(msg) {
  const match = String(msg).match(/(\d+)\s*segundo/i);
  if (match) return Math.min(Number(match[1]), 1800);
  return 300;
}

async function omieCall(base44, endpoint, param, options = {}) {
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
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
        signal: controller.signal
      });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) {
          lastErr = data.faultstring;
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        }
        throw new Error(data.faultstring);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

function pedidoCancelado(pedido) {
  const cab = pedido?.cabecalho || {};
  const info = [cab.cancelado, cab.status_pedido, cab.status, cab.etapa, cab.descricao_status]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return cab.cancelado === 'S' || info.includes('cancelado') || info.includes('cancelada');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      etapa = '50',
      data_inicial,
      data_final,
      pagina = 1,
      registros_por_pagina = 100,
      apenas_faturar = false,
      incluir_cancelados = false,
      buscar_todas_paginas = false,
      max_paginas = 10
    } = body;

    const param = {
      pagina,
      registros_por_pagina: Math.min(registros_por_pagina, 100),
      apenas_importado_api: 'N'
    };
    if (etapa) param.etapa = String(etapa);
    if (data_inicial) param.filtrar_por_data_de = data_inicial;
    if (data_final) param.filtrar_por_data_ate = data_final;
    if (apenas_faturar) param.filtrar_apenas_ab_pedidos = 'S';

    const t0 = Date.now();
    let data;
    let todosPedidosOmie = [];
    try {
      data = await omieCall(base44, 'produtos/pedido/', param, { call: 'ListarPedidos' });
      todosPedidosOmie = data.pedido_venda_produto || [];

      if (buscar_todas_paginas) {
        const totalPaginas = Math.min(Number(data.total_de_paginas || 1), Number(max_paginas || 10));
        for (let pag = 2; pag <= totalPaginas; pag++) {
          const paginaData = await omieCall(base44, 'produtos/pedido/', { ...param, pagina: pag }, { call: 'ListarPedidos' });
          todosPedidosOmie.push(...(paginaData.pedido_venda_produto || []));
        }
      }
    } catch (e) {
      if (/n[ãa]o existem registros/i.test(e.message)) {
        return Response.json({ sucesso: true, pedidos: [], pagina, total_de_paginas: 0, total_de_registros: 0, registros: 0 });
      }
      if (/bloqueada por consumo indevido|consumo redundante|aguarde/i.test(e.message)) {
        return Response.json({ sucesso: false, pedidos: [], error: e.message, bloqueado_omie: true }, { status: 429 });
      }
      throw e;
    }
    const duracao = Date.now() - t0;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'ListarPedidos',
      operacao: 'buscar_pedidos_logistica',
      status: 'sucesso',
      duracao_ms: duracao,
      usuario_email: user.email
    }).catch(() => {});

    const pedidos = todosPedidosOmie
      .filter(p => incluir_cancelados || !pedidoCancelado(p))
      .map(p => {
        const cancelado = pedidoCancelado(p);
        const cab = p.cabecalho || {};
        return {
          codigo_pedido: String(cab.codigo_pedido || ''),
          codigo_pedido_integracao: cab.codigo_pedido_integracao || '',
          numero_pedido: String(cab.numero_pedido || '').replace(/^0+/, '') || '',
          codigo_cliente: String(cab.codigo_cliente || ''),
          cliente_nome: cab.razao_social || cab.nome_fantasia || '',
          cliente_cpf_cnpj: cab.cnpj_cpf || '',
          cliente_cidade: cab.cidade || '',
          data_previsao: cab.data_previsao || '',
          etapa: cancelado ? 'cancelado' : (cab.etapa || ''),
          status_pedido: cancelado ? 'cancelado' : (cab.status_pedido || cab.status || ''),
          cancelado,
          valor_total_pedido: p.total_pedido?.valor_total_pedido || 0,
          numero_nf: p.infoCadastro?.numero_nf || cab.numero_nfe || '',
          quantidade_itens: (p.det || []).length,
          produtos: (p.det || []).map(d => ({
            codigo_produto: String(d.produto?.codigo_produto || ''),
            codigo_produto_integracao: d.produto?.codigo_produto_integracao || '',
            descricao: d.produto?.descricao || '',
            quantidade: d.produto?.quantidade || 0,
            valor_unitario: d.produto?.valor_unitario || 0,
            valor_total: d.produto?.valor_total || 0,
            unidade: d.produto?.unidade || ''
          }))
        };
      });

    return Response.json({
      sucesso: true,
      pedidos,
      pagina: data.pagina,
      total_de_paginas: data.total_de_paginas,
      total_de_registros: data.total_de_registros,
      registros: pedidos.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});