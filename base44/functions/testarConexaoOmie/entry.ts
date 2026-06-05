import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7: _shared/omieClient
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

const OMIE_URL = 'https://app.omie.com.br/api/v1/geral/empresas/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve credenciais priorizando a ConfiguracaoOmie ativa (banco) e só caindo
// para os Secrets se não houver config ativa.
// ✅ resolverCreds → _shared/omieClient

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
// ✅ omieCall local → wrapper _shared/omieClient
async function omieCall(base44, callOrEndpoint, param, optsOrUndef) {
  if (typeof optsOrUndef === 'object' && optsOrUndef !== null) return omieCallShared(base44, callOrEndpoint, param, optsOrUndef);
  if (callOrEndpoint && callOrEndpoint.includes('/')) return omieCallShared(base44, callOrEndpoint, param, {});
  return omieCallShared(base44, 'produtos/pedido/', param, { call: callOrEndpoint });
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