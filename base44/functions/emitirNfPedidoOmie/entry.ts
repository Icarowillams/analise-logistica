import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

// ENDPOINT CORRETO: pedidovendafat (Faturamento de Pedido de Venda) — diferente de /pedido/
const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

function formatarDataBrasilia(isoDate) {
  return new Date(isoDate).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function criarErroOmie(data, fallback = 'Erro Omie') {
  const error = new Error(data?.faultstring || fallback);
  error.faultstring = data?.faultstring || fallback;
  error.faultcode = data?.faultcode || '';
  error.omiePayload = data || null;
  return error;
}

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  return null;
}
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

// omieCall robusto: circuit breaker + 425 (bloqueio 30min, sem retry) + retry 429.
// Usa endpoint /produtos/pedidovendafat/ (FaturarPedidoVenda/ValidarPedidoVenda). Lança erro estruturado em faultstring.
async function resolverCredsOmie(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  if (ativo?.app_key && ativo?.app_secret) return { OMIE_APP_KEY: String(ativo.app_key), OMIE_APP_SECRET: String(ativo.app_secret) };
  return { OMIE_APP_KEY: Deno.env.get('OMIE_APP_KEY'), OMIE_APP_SECRET: Deno.env.get('OMIE_APP_SECRET') };
}

async function omieCall(base44, call, param, options = {}) {
  const { OMIE_APP_KEY, OMIE_APP_SECRET } = await resolverCredsOmie(base44);
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) throw new Error('Credenciais Omie não configuradas: OMIE_APP_KEY/OMIE_APP_SECRET.');
  console.log(`[emitirNfPedidoOmie] Conectando ao Omie com APP_KEY: ...${String(OMIE_APP_KEY).slice(-4)} | método: ${call}`);
  const maxTentativas = options.maxTentativas || 3;
  const cacheKey = `${call}_${JSON.stringify(param)}`;
  const isReadOnly = /^(Listar|Consultar|Pesquisar|Buscar)/.test(call);
  if (isReadOnly) {
    const cached = getFromMemoryCache(cacheKey);
    if (cached) return cached;
  }

  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    const err = new Error(`API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`);
    err.code = 'OMIE_425';
    err.bloqueado_ate = controle.bloqueado_ate;
    throw err;
  }

  const body = { call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] };
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
    try {
      const res = await fetch(OMIE_FAT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();

      if (data.faultstring || data.faultcode) {
        const msg = String(data.faultstring || '').toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloquead') || msg.includes('bloqueio')) {
          const bloqueadoAte = new Date(Date.now() + 30 * 60000).toISOString();
          const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: bloqueadoAte, ultimo_erro: data.faultstring || 'HTTP 425 consumo indevido', atualizado_em: new Date().toISOString() };
          if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
          else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
          await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: OMIE_FAT_URL, call, operacao: call, status: 'erro', codigo_erro: '425',
            mensagem_erro: data.faultstring || 'HTTP 425 — consumo indevido',
            payload_enviado: JSON.stringify(param || {}).slice(0, 2000),
            payload_resposta: JSON.stringify(data || {}).slice(0, 2000)
          }).catch(() => {});
          const err = new Error(`API Omie bloqueada por consumo indevido (HTTP 425). Desbloqueio previsto: ${new Date(bloqueadoAte).toLocaleString('pt-BR')}.`);
          err.code = 'OMIE_425';
          err.bloqueado_ate = bloqueadoAte;
          throw err;
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('indispon')) {
          lastError = data.faultstring;
          if (tentativa < maxTentativas) { await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
        }
        throw criarErroOmie(data);
      }

      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: OMIE_FAT_URL, call, operacao: call, status: 'sucesso',
          payload_enviado: JSON.stringify(param || {}).slice(0, 2000),
          payload_resposta: JSON.stringify(data || {}).slice(0, 2000)
        }).catch(() => {});
      }
      if (isReadOnly) setMemoryCache(cacheKey, data);
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.code === 'OMIE_425' || err.faultstring) throw err;
      lastError = err.message;
      if (tentativa < maxTentativas) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, tentativa)));
    }
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

// Dispara a emissão da NF-e via Omie usando FaturarPedidoVenda
// (endpoint /produtos/pedidovendafat/ — diferente do /produtos/pedido/).
// O Omie processa de forma assíncrona — a etapa só vai pra 60 quando a SEFAZ autorizar.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, codigo_pedido_integracao, validar_apenas = false } = body;

    if (!codigo_pedido && !codigo_pedido_integracao) {
      return Response.json({ error: 'Informe codigo_pedido ou codigo_pedido_integracao' }, { status: 400 });
    }

    if (codigo_pedido) {
      const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigo_pedido) }, '-updated_date', 1).catch(() => []);
      const pedidoLocal = pedidosLocais?.[0];
      if (pedidoLocal?.faturado || pedidoLocal?.status === 'faturado' || pedidoLocal?.status_faturamento === 'faturado' || pedidoLocal?.numero_nota_fiscal) {
        return Response.json({
          sucesso: false,
          error: `Pedido ${pedidoLocal.numero_pedido || codigo_pedido} já foi faturado${pedidoLocal.numero_nota_fiscal ? ` com NF ${pedidoLocal.numero_nota_fiscal}` : ''}. Reemissão bloqueada para evitar duplicidade.`,
          codigo_pedido: String(codigo_pedido),
          numero_nf: pedidoLocal.numero_nota_fiscal || ''
        }, { status: 400 });
      }
    }

    // Parâmetros conforme doc Omie: nCodPed (integer) e cCodIntPed (string60)
    const param = {};
    if (codigo_pedido) param.nCodPed = Number(codigo_pedido);
    if (codigo_pedido_integracao) param.cCodIntPed = codigo_pedido_integracao;

    const callName = validar_apenas ? 'ValidarPedidoVenda' : 'FaturarPedidoVenda';
    const t0 = Date.now();
    let resposta;
    try {
      resposta = await omieCall(base44, callName, param);
    } catch (e) {
      if (e.code === 'OMIE_425') throw e; // propaga bloqueio ao catch externo
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'produtos/pedidovendafat',
        call: callName,
        operacao: validar_apenas ? 'validar_nf' : 'emitir_nf',
        status: e.faultstring ? 'erro_omie' : 'erro',
        codigo_erro: e.faultcode || '',
        duracao_ms: Date.now() - t0,
        mensagem_erro: e.faultstring || e.message,
        erro_detalhado: e.faultstring || `Erro interno: ${e.message}`,
        payload_enviado: JSON.stringify(param).substring(0, 2000),
        payload_resposta: e.omiePayload ? JSON.stringify(e.omiePayload).substring(0, 5000) : '',
        usuario_email: user.email
      }).catch(() => {});
      return Response.json({ sucesso: false, error: e.faultstring || e.message, faultstring: e.faultstring || '', faultcode: e.faultcode || '' }, { status: 400 });
    }

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedidovendafat',
      call: callName,
      operacao: validar_apenas ? 'validar_nf' : 'emitir_nf',
      status: 'sucesso',
      duracao_ms: Date.now() - t0,
      payload_enviado: JSON.stringify(param).substring(0, 1500),
      payload_resposta: JSON.stringify(resposta).substring(0, 1500),
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      mensagem: resposta?.cDescStatus || 'Pedido enviado para emissão de NF-e. Aguarde alguns minutos para o Omie processar.',
      cCodStatus: resposta?.cCodStatus,
      cDescStatus: resposta?.cDescStatus,
      resposta
    });
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});