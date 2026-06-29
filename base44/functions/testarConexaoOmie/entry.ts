// deploy v6 — 2026-06-05 — self-contained + log de sucesso + cache anti-REDUNDANT
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = "https://app.omie.com.br/api/v1/";
const DEFAULT_TIMEOUT_MS = 15000;

let _credsCache = null;
// Cache do resultado do teste para evitar erro REDUNDANT do Omie (mesmo payload em < 30s)
let _testCache: { result: unknown; at: number } | null = null;
const TEST_CACHE_TTL_MS = 30_000; // Omie exige mínimo ~20s entre chamadas idênticas
async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30000) return _credsCache;
  // ENV PRIMEIRO (fonte de verdade). Banco só como fallback.
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) {
    _credsCache = { appKey: envKey, appSecret: envSecret, at: Date.now() };
    return _credsCache;
  }
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  _credsCache = { appKey: String(ativo?.app_key || '').trim(), appSecret: String(ativo?.app_secret || '').trim(), at: Date.now() };
  return _credsCache;
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const control = rows?.[0];
  if (!control?.bloqueado) return { blocked: false };
  const blockedUntil = control.bloqueado_ate ? new Date(control.bloqueado_ate).getTime() : 0;
  if (blockedUntil && blockedUntil <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(control.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => {});
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: control.bloqueado_ate, lastError: control.ultimo_erro };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Verificar circuit breaker
    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) {
      return Response.json({
        ok: false,
        bloqueado: true,
        bloqueado_ate: cb.blockedUntil,
        error: `Circuit breaker ativo até ${cb.blockedUntil}`
      }, { status: 425 });
    }

    const { appKey, appSecret } = await getOmieCredentials(base44);
    if (!appKey || !appSecret) {
      return Response.json({
        ok: false,
        error: 'Credenciais Omie não configuradas.',
        debug: { appKey_presente: !!appKey, appSecret_presente: !!appSecret }
      });
    }

    // Retornar resultado em cache se chamada em menos de 30s (evita REDUNDANT do Omie)
    if (_testCache && Date.now() - _testCache.at < TEST_CACHE_TTL_MS) {
      return Response.json({ ..._testCache.result as any, cached: true, cache_age_ms: Date.now() - _testCache.at });
    }

    const startedAt = Date.now();
    const url = OMIE_BASE_URL + 'geral/empresas/';
    const body = {
      call: 'ListarEmpresas',
      app_key: appKey,
      app_secret: appSecret,
      param: [{ pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N' }]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      const duracao_ms = Date.now() - startedAt;
      const msg = fetchErr.name === 'AbortError' ? `Timeout de ${DEFAULT_TIMEOUT_MS}ms` : fetchErr.message;
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'geral/empresas',
        call: 'ListarEmpresas',
        operacao: 'testar_conexao',
        status: 'erro',
        mensagem_erro: msg,
        duracao_ms,
        tentativas: 1,
        usuario_email: user.email
      }).catch(() => {});
      return Response.json({ ok: false, error: msg, duracao_ms });
    }
    clearTimeout(timer);

    const text = await response.text();
    const duracao_ms = Date.now() - startedAt;
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }

    if (!response.ok || data.faultstring) {
      const errorMsg = data.faultstring || `Erro HTTP ${response.status}`;
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'geral/empresas',
        call: 'ListarEmpresas',
        operacao: 'testar_conexao',
        status: 'erro',
        codigo_erro: data.faultcode || String(response.status),
        mensagem_erro: errorMsg,
        duracao_ms,
        tentativas: 1,
        usuario_email: user.email
      }).catch(() => {});
      return Response.json({ ok: false, error: errorMsg, code: data.faultcode || null, duracao_ms });
    }

    // ✅ Log de sucesso — estava faltando na v4
    const empresa = data?.empresas_cadastro?.[0] || {};

    // Cachear resultado por 30s para evitar REDUNDANT em cliques seguidos
    const successResult = {
      ok: true,
      duracao_ms,
      empresa: {
        razao_social: empresa.razao_social,
        cnpj: empresa.cnpj,
        nome_fantasia: empresa.nome_fantasia
      },
      total_empresas: data?.total_de_registros || 0
    };
    _testCache = { result: successResult, at: Date.now() };

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'geral/empresas',
      call: 'ListarEmpresas',
      operacao: 'testar_conexao',
      status: 'sucesso',
      duracao_ms,
      tentativas: 1,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json(successResult);
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});