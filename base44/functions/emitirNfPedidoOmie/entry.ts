import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

// ENDPOINT CORRETO: pedidovendafat (Faturamento de Pedido de Venda) — diferente de /pedido/
const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

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

async function omieCall(base44, endpoint, param, options = {}) {
  const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
  const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
  const cacheKey = `${endpoint}_${JSON.stringify(param)}`;
  const isReadOnly = /^(Listar|Consultar|Pesquisar|Buscar)/.test(endpoint);
  if (isReadOnly) {
    const cached = getFromMemoryCache(cacheKey);
    if (cached) return cached;
  }
  
  const body = {
    call: endpoint,
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param]
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
  
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://app.omie.com.br/api/v1/geral/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      
      const data = await res.json();
      
      if (!options.skipLog) {
        try {
          await base44.entities.create('LogIntegracaoOmie', {
            endpoint,
            payload_envio: JSON.stringify(param).slice(0, 2000),
            payload_resposta: JSON.stringify(data).slice(0, 2000),
            sucesso: !data.faultcode,
            erro: data.faultstring || null,
            created_date: new Date().toISOString()
          });
        } catch(logErr) { /* silent fail */ }
      }
      if (isReadOnly) setMemoryCache(cacheKey, data);
      
      return data;
    } catch(err) {
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});