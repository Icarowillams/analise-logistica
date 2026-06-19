import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 🧹 Limpeza automática (rotina de MANUTENÇÃO/leitura pura — sem risco fiscal, pode ser agendada).
// - CacheOmieConsulta: remove TODA entrada com expira_em vencido (respeita o TTL real de cada item).
//   Entradas legado SEM expira_em → fallback por idade (created_date/criado_em < hoje-1d).
// - LogIntegracaoOmie: remove sucesso (status != erro) com created_date < hoje-90d; erros ficam 365d
// - RateLimitWebhook: remove com ultima_requisicao < hoje-1d
// - Registra UM resumo em LogGerencial.
// Idempotente: rodar de novo sem entradas vencidas simplesmente não remove nada.
// Roda 1x/h — não precisa esvaziar tudo num disparo; processa MAX_POR_EXECUCAO por vez.

const MAX_POR_EXECUCAO = 150; // teto de deleções por entidade por execução (resto sai na próxima rodada)
const PAUSA_MS = 150; // intervalo entre deleções p/ não estourar o rate limit do SDK Base44 (429)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Deleção SEQUENCIAL (1 por vez) com try/catch por item — segura contra rate limit.
async function deletarLote(base44, entityName, registros) {
  let removidos = 0;
  const alvo = registros.slice(0, MAX_POR_EXECUCAO);
  for (const r of alvo) {
    try {
      await base44.asServiceRole.entities[entityName].delete(r.id);
      removidos++;
    } catch { /* item já removido ou indisponível — ignora */ }
    await sleep(PAUSA_MS);
  }
  return removidos;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const agora = Date.now();
    const corte90d = agora - 90 * 86400000;
    const corte365d = agora - 365 * 86400000;
    const corte1d = agora - 1 * 86400000;

    // a. CacheOmieConsulta — respeita o expira_em de CADA entrada.
    //    Vencido = expira_em < agora. Legado sem expira_em → fallback por idade (>1d).
    const caches = await base44.asServiceRole.entities.CacheOmieConsulta.list('-created_date', 5000).catch(() => []);
    const cachesExpirados = caches.filter(c => {
      if (c.expira_em) return new Date(c.expira_em).getTime() < agora;
      const idade = new Date(c.created_date || c.criado_em || 0).getTime();
      return idade < corte1d;
    });
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

    return Response.json({ sucesso: true, cache_total: caches.length, cache_removidos: cacheRemovidos, logs_removidos: logRemovidos, rate_limits_removidos: rateRemovidos });
  } catch (error) {
    console.error('[limparCacheExpiradoOmie] erro:', error);
    return Response.json({ sucesso: false, error: 'Limpeza falhou' }, { status: 500 });
  }
});