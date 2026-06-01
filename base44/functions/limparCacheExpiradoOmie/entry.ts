import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

// 🧹 Limpeza automática diária (03:00) — idempotente.
// - CacheOmieConsulta: remove com created_date < hoje-7d
// - LogIntegracaoOmie: remove sucesso (status != erro) com created_date < hoje-90d; erros ficam 365d
// - RateLimitWebhook: remove com ultima_requisicao < hoje-1d
// - Registra UM resumo em LogGerencial.

const LOTE = 100;

async function deletarLote(base44, entityName, registros) {
  let removidos = 0;
  for (let i = 0; i < registros.length; i += LOTE) {
    const lote = registros.slice(i, i + LOTE);
    await Promise.all(
      lote.map(r => base44.asServiceRole.entities[entityName].delete(r.id).then(() => { removidos++; }).catch(() => {}))
    );
  }
  return removidos;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const agora = Date.now();
    const corte7d = new Date(agora - 7 * 86400000).getTime();
    const corte90d = new Date(agora - 90 * 86400000).getTime();
    const corte365d = new Date(agora - 365 * 86400000).getTime();
    const corte1d = new Date(agora - 1 * 86400000).getTime();

    // a. CacheOmieConsulta — created_date < hoje-7d
    const caches = await base44.asServiceRole.entities.CacheOmieConsulta.list('-created_date', 5000).catch(() => []);
    const cachesExpirados = caches.filter(c => new Date(c.created_date || 0).getTime() < corte7d);
    const cacheRemovidos = await deletarLote(base44, 'CacheOmieConsulta', cachesExpirados);

    // b. LogIntegracaoOmie — sucesso < 90d; erros < 365d
    const logs = await base44.asServiceRole.entities.LogIntegracaoOmie.list('-created_date', 10000).catch(() => []);
    const logsExpirados = logs.filter(l => {
      const ts = new Date(l.created_date || 0).getTime();
      const ehErro = ['erro', 'erro_omie'].includes(String(l.status || ''));
      return ehErro ? ts < corte365d : ts < corte90d;
    });
    const logRemovidos = await deletarLote(base44, 'LogIntegracaoOmie', logsExpirados);

    // c. RateLimitWebhook — ultima_requisicao < hoje-1d
    const rateLimits = await base44.asServiceRole.entities.RateLimitWebhook.list('-created_date', 5000).catch(() => []);
    const rateExpirados = rateLimits.filter(r => new Date(r.ultima_requisicao || 0).getTime() < corte1d);
    const rateRemovidos = await deletarLote(base44, 'RateLimitWebhook', rateExpirados);

    // d. Resumo em LogGerencial
    const descricao = `Limpeza automática: ${cacheRemovidos} cache, ${logRemovidos} logs, ${rateRemovidos} rate limits removidos`;
    await base44.asServiceRole.entities.LogGerencial.create({
      tipo_acao: 'outro',
      entidade_tipo: 'Manutencao',
      usuario_email: 'sistema@automacao',
      usuario_nome: 'Limpeza Automática',
      descricao,
      origem: 'automation',
      observacao: 'MANUTENCAO_ROTINEIRA'
    }).catch(() => {});

    return Response.json({ sucesso: true, cache_removidos: cacheRemovidos, logs_removidos: logRemovidos, rate_limits_removidos: rateRemovidos });
  } catch (error) {
    console.error('[limparCacheExpiradoOmie] erro:', error);
    return Response.json({ sucesso: false, error: 'Limpeza falhou' }, { status: 500 });
  }
});