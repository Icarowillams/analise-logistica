import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

// ENDPOINT CORRETO: pedidovendafat (Faturamento de Pedido de Venda) — diferente de /pedido/
const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';

// 🐛 FIX: Credenciais removidas do top-level — resolvidas dinamicamente pelo handler
// ✅ resolverCreds removida

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

// ✅ omieCall local → wrapper _shared/omieClient
async function omieCall(base44, callOrEndpoint, param, optsOrCall) {
  if (typeof optsOrCall === 'object') return omieCallShared(base44, callOrEndpoint, param, optsOrCall || {});
  if (typeof optsOrCall === 'string') return omieCallShared(base44, callOrEndpoint, param, { call: optsOrCall });
  return omieCallShared(base44, 'produtos/pedidovendafat/', param, { call: callOrEndpoint });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    // 🐛 FIX: Credenciais resolvidas dentro do handler — evita uso de creds stale em warm starts
    const { APP_KEY, APP_SECRET } = await resolverCredsOmie(base44);
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