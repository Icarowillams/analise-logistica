import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cacheKey(url, call, param) {
  return `${url}|${call}|${JSON.stringify(param || {})}`;
}

async function getCircuitBreaker(base44) {
  const registros = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1);
  return registros?.[0] || null;
}

async function setCircuitBreaker(base44, erro) {
  const payload = {
    chave: 'principal',
    bloqueado: true,
    bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(),
    ultimo_erro: erro || '',
    atualizado_em: new Date().toISOString()
  };
  const existente = await getCircuitBreaker(base44);
  if (existente?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(existente.id, payload);
  else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payload);
  return payload;
}

async function getCache(base44, chave) {
  const registros = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1);
  const cache = registros?.[0];
  if (cache && new Date(cache.expira_em) > new Date()) return cache;
  return null;
}

async function saveCache(base44, chave, call, data, cacheMinutes) {
  const payload = {
    chave,
    valor: data,
    tipo: call,
    expira_em: new Date(Date.now() + cacheMinutes * 60000).toISOString(),
    criado_em: new Date().toISOString()
  };
  const existente = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1);
  if (existente?.[0]?.id) await base44.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payload);
  else await base44.asServiceRole.entities.CacheOmieConsulta.create(payload);
}

async function logIntegration(base44, call, status, param, data, error) {
  await base44.asServiceRole.entities.LogIntegracaoOmie.create({
    endpoint: 'omieDispatcher',
    call,
    operacao: call,
    status,
    mensagem_erro: error || null,
    payload_enviado: JSON.stringify(param || {}).slice(-500),
    payload_resposta: JSON.stringify(data || {}).slice(-500)
  }).catch(() => {});
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { url, call, param, cacheMinutes = 0, logIntegration: shouldLog = false } = body;
    if (!url || !call) return Response.json({ success: false, error: 'url e call são obrigatórios' }, { status: 400 });

    const cb = await getCircuitBreaker(base44);
    if (cb?.bloqueado && cb.bloqueado_ate && new Date(cb.bloqueado_ate) > new Date()) {
      return Response.json({ success: false, error: `API Omie bloqueada temporariamente. Tente novamente em ${cb.bloqueado_ate}`, isBlocked: true });
    }

    const chave = cacheKey(url, call, param);
    if (cacheMinutes > 0) {
      const cache = await getCache(base44, chave);
      if (cache) return Response.json({ success: true, data: cache.valor, fromCache: true });
    }

    let lastError = '';
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call,
          app_key: Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY'),
          app_secret: Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET'),
          param: [param]
        })
      });
      const data = await res.json();
      if (data.faultcode || data.faultstring) {
        const msg = String(data.faultstring || '').toLowerCase();
        if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
          const controle = await setCircuitBreaker(base44, data.faultstring || 'Bloqueio Omie');
          if (shouldLog) await logIntegration(base44, call, 'erro', param, data, data.faultstring);
          return Response.json({ success: false, error: data.faultstring, isBlocked: true, bloqueado_ate: controle.bloqueado_ate });
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon')) {
          lastError = data.faultstring;
          await sleep(2500 * tentativa);
          continue;
        }
        if (shouldLog) await logIntegration(base44, call, 'erro', param, data, data.faultstring);
        return Response.json({ success: false, error: data.faultstring });
      }

      if (cacheMinutes > 0) await saveCache(base44, chave, call, data, cacheMinutes);
      if (shouldLog) await logIntegration(base44, call, 'sucesso', param, data, null);
      return Response.json({ success: true, data });
    }

    return Response.json({ success: false, error: lastError, isRateLimit: true });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});