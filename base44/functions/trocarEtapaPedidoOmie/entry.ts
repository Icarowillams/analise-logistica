import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.omie_app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.omie_app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
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
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const until = new Date(Date.now() + 30 * 60000).toISOString();
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: 'principal', bloqueado: true, bloqueado_ate: until, ultimo_erro: data.faultstring, atualizado_em: new Date().toISOString() }).catch(() => null);
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
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
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

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

);
  if (typeof optsOrCall === 'string') return omieCall(base44, callOrEndpoint, param, { call: optsOrCall });
  return omieCall(base44, 'produtos/pedido/', param, { call: callOrEndpoint });
}

async function trocarUmPedido(base44, pedido, etapaDestino) {
  const etapa = String(pedido.etapa || etapaDestino || '');
  if (!etapa) return { sucesso: false, mensagem: 'etapa obrigatória', ...pedido };
  if (!pedido.codigo_pedido && !pedido.codigo_pedido_integracao) {
    return { sucesso: false, mensagem: 'Informe codigo_pedido ou codigo_pedido_integracao', ...pedido };
  }

  const param = { etapa };
  if (pedido.codigo_pedido) param.codigo_pedido = Number(pedido.codigo_pedido);
  if (pedido.codigo_pedido_integracao) param.codigo_pedido_integracao = String(pedido.codigo_pedido_integracao);

  try {
    const resposta = await omieCall(base44, 'TrocarEtapaPedido', param);
    await new Promise(r => setTimeout(r, 1200));
    return {
      codigo_pedido: pedido.codigo_pedido,
      codigo_pedido_integracao: pedido.codigo_pedido_integracao,
      numero_pedido: pedido.numero_pedido,
      etapa,
      sucesso: true,
      resposta
    };
  } catch (e) {
    if (e.code === 'OMIE_425') throw e; // propaga bloqueio para parar o lote
    return {
      codigo_pedido: pedido.codigo_pedido,
      codigo_pedido_integracao: pedido.codigo_pedido_integracao,
      numero_pedido: pedido.numero_pedido,
      etapa,
      sucesso: false,
      mensagem: e.message
    };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const pedidos = Array.isArray(body.pedidos) ? body.pedidos : null;

    if (pedidos) {
      const resultados = [];
      for (const pedido of pedidos) {
        resultados.push(await trocarUmPedido(base44, pedido, body.etapa_destino));
      }
      const sucessos = resultados.filter(r => r.sucesso).length;
      const erros = resultados.length - sucessos;
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'produtos/pedido',
        call: 'TrocarEtapaPedido',
        operacao: `trocar_etapa_lote_${body.etapa_destino || 'multi'}`,
        status: erros > 0 ? 'warning' : 'sucesso',
        mensagem_erro: erros > 0 ? `${erros} pedidos falharam` : null,
        usuario_email: user.email
      }).catch(() => {});
      return Response.json({ sucesso: true, total: pedidos.length, sucessos, erros, resultados });
    }

    const resultado = await trocarUmPedido(base44, body, body.etapa);
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'TrocarEtapaPedido',
      operacao: 'trocar_etapa',
      status: resultado.sucesso ? 'sucesso' : 'erro',
      mensagem_erro: resultado.sucesso ? null : resultado.mensagem,
      payload_enviado: JSON.stringify(body).substring(0, 1500),
      payload_resposta: JSON.stringify(resultado).substring(0, 1500),
      usuario_email: user.email
    }).catch(() => {});

    if (!resultado.sucesso) return Response.json({ sucesso: false, error: resultado.mensagem, resultado }, { status: 400 });
    return Response.json(resultado);
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});