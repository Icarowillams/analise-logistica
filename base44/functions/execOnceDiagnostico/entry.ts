import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// FUNÇÃO TEMPORÁRIA DE DIAGNÓSTICO — SEM AUTENTICAÇÃO
// Remover após uso.

const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // 1. Estado do circuit breaker
    const cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
      .filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
    const cb = cbRows?.[0] || null;

    const agora = Date.now();
    const bloqueadoAte = cb?.bloqueado_ate ? new Date(cb.bloqueado_ate).getTime() : 0;
    const bloqueadoAtivo = cb?.bloqueado && bloqueadoAte > agora;
    const tempoRestanteSeg = bloqueadoAtivo ? Math.ceil((bloqueadoAte - agora) / 1000) : 0;

    const circuitBreaker = cb ? {
      id: cb.id,
      bloqueado: cb.bloqueado ?? false,
      bloqueado_ativo: bloqueadoAtivo,
      bloqueado_ate: cb.bloqueado_ate ?? null,
      tempo_restante_segundos: tempoRestanteSeg,
      erros_consecutivos: cb.erros_consecutivos ?? 0,
      threshold_erros: cb.threshold_erros ?? 3,
      ultimo_erro: cb.ultimo_erro ?? null,
      atualizado_em: cb.atualizado_em ?? null,
    } : { encontrado: false };

    // 2. Cargas aguardando fila
    const cargas = await base44.asServiceRole.entities.Carga
      .filter({ proc_omie: 'aguardando_fila' }, 'updated_date', 200).catch(() => []);

    const agora30 = new Date(agora - 30 * 60 * 1000).toISOString();
    const cargasComAtraso = (cargas || []).map(c => ({
      id: c.id,
      numero_carga: c.numero_carga ?? null,
      proc_omie: c.proc_omie,
      updated_date: c.updated_date ?? null,
      atraso_maior_30min: c.updated_date ? c.updated_date < agora30 : null,
    }));

    // 3. Últimos 5 logs
    const logs = await base44.asServiceRole.entities.LogIntegracaoOmie
      .filter({}, '-created_date', 5).catch(() => []);

    const ultimosLogs = (logs || []).map(l => ({
      id: l.id,
      created_date: l.created_date ?? null,
      endpoint: l.endpoint ?? null,
      call: l.call ?? null,
      operacao: l.operacao ?? null,
      status: l.status ?? null,
      mensagem_erro: l.mensagem_erro ?? null,
    }));

    return Response.json({
      timestamp: new Date().toISOString(),
      circuit_breaker: circuitBreaker,
      cargas_aguardando_fila: {
        total: cargasComAtraso.length,
        com_atraso_maior_30min: cargasComAtraso.filter(c => c.atraso_maior_30min).length,
        itens: cargasComAtraso,
      },
      ultimos_logs_integracao: ultimosLogs,
    });
  } catch (error) {
    return Response.json({ erro: error.message, stack: error.stack }, { status: 500 });
  }
});
