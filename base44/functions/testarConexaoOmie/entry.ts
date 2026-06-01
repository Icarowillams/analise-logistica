import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_URL = 'https://app.omie.com.br/api/v1/geral/empresas/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve credenciais priorizando a ConfiguracaoOmie ativa (banco) e só caindo
// para os Secrets se não houver config ativa.
async function resolverCreds(base44) {
  try {
    const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1);
    const cfg = configs?.[0];
    if (cfg?.app_key && cfg?.app_secret) return { app_key: cfg.app_key, app_secret: cfg.app_secret };
  } catch { /* fallback para secrets */ }
  return { app_key: Deno.env.get('OMIE_APP_KEY'), app_secret: Deno.env.get('OMIE_APP_SECRET') };
}

// Throttle global persistido: garante intervalo mínimo entre chamadas Omie de
// qualquer função, evitando "Consumo redundante / cota".
const GLOBAL_MIN_INTERVAL_MS = 1500;
const GLOBAL_RATE_KEY = 'rate_limit_global';
async function throttleGlobal(base44) {
  try {
    const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: GLOBAL_RATE_KEY }, '-updated_date', 1).catch(() => []);
    const row = rows?.[0];
    const last = row?.atualizado_em ? new Date(row.atualizado_em).getTime() : 0;
    const wait = GLOBAL_MIN_INTERVAL_MS - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    const payload = { chave: GLOBAL_RATE_KEY, atualizado_em: new Date().toISOString() };
    if (row?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(row.id, payload).catch(() => {});
    else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payload).catch(() => {});
  } catch { /* não bloqueia a chamada se o rate limiter falhar */ }
}

// Chamada centralizada à Omie: circuit breaker, throttle global, retry e logging.
async function omieCall(base44, call, param, usuarioEmail) {
  const { app_key, app_secret } = await resolverCreds(base44);

  // Circuit breaker
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    const ate = new Date(controle.bloqueado_ate).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const err = new Error(`API Omie bloqueada por rate limit. Tente novamente após ${ate} (horário de Brasília).`);
    err.bloqueado_ate = controle.bloqueado_ate;
    err.bloqueado = true;
    throw err;
  }

  await throttleGlobal(base44);

  let lastError = '';
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const res = await fetch(OMIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] })
    });
    const data = await res.json();

    if (data.faultstring || data.faultcode) {
      const erro = data.faultstring || 'Erro Omie';
      const msg = String(erro).toLowerCase();
      // Bloqueio explícito → abre o circuit breaker.
      if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('consumo indevido') || msg.includes('tente novamente mais tarde')) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: erro, atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
        else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        const err = new Error(erro);
        err.faultcode = data.faultcode;
        throw err;
      }
      // Rate limit transitório (cota/redundante/aguarde) → retry com backoff.
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon')) {
        lastError = erro;
        await sleep(2500 * tentativa);
        continue;
      }
      const err = new Error(erro);
      err.faultcode = data.faultcode;
      throw err;
    }

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'geral/empresas',
      call,
      operacao: 'testar_conexao',
      status: 'sucesso',
      payload_resposta: JSON.stringify(data).slice(0, 2000),
      tentativas: tentativa,
      usuario_email: usuarioEmail
    }).catch(() => {});

    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const startedAt = Date.now();
    let json;
    try {
      json = await omieCall(base44, 'ListarEmpresas', { pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N' }, user.email);
    } catch (error) {
      const duracao_ms = Date.now() - startedAt;
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'geral/empresas',
        call: 'ListarEmpresas',
        operacao: 'testar_conexao',
        status: 'erro',
        codigo_erro: error.faultcode || '',
        mensagem_erro: error.message,
        duracao_ms,
        tentativas: 1,
        usuario_email: user.email
      }).catch(() => {});

      return Response.json({
        ok: false,
        bloqueado: error.bloqueado || false,
        bloqueado_ate: error.bloqueado_ate || null,
        error: error.message,
        code: error.faultcode || null,
        duracao_ms
      }, { status: error.bloqueado ? 425 : 200 });
    }

    const duracao_ms = Date.now() - startedAt;
    const empresa = json?.empresas_cadastro?.[0] || {};
    return Response.json({
      ok: true,
      duracao_ms,
      empresa: {
        razao_social: empresa.razao_social,
        cnpj: empresa.cnpj,
        nome_fantasia: empresa.nome_fantasia
      },
      total_empresas: json?.total_de_registros || 0
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});