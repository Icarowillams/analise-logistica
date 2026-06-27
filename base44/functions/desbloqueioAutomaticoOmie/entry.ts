import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 🔓 DESBLOQUEIO AUTOMÁTICO PRECISO DOS CIRCUIT BREAKERS OMIE
// ─────────────────────────────────────────────────────────────────────────────
// REGRA DE PRECISÃO (essencial — NÃO desbloquear cegamente):
//   Só desbloqueia um breaker quando `bloqueado_ate` JÁ PASSOU. Isso significa que
//   o cooldown imposto pelo Omie ("Consumo indevido" → janela de espera) terminou e
//   a API está realmente liberada. Desbloquear ANTES disso faz o sistema chamar a
//   API durante o cooldown → leva bloqueio de novo → loop infinito. Por isso a
//   condição de tempo é obrigatória.
//
//   Casos tratados:
//   1) bloqueado=true e bloqueado_ate no passado → DESBLOQUEIA + zera erros.
//   2) bloqueado=true e bloqueado_ate vazio/null → bloqueio sem prazo (cautela):
//      NÃO desbloqueia automaticamente (precisa de ação manual, evita liberar cego).
//   3) worker_rodando=true e worker_lock_ate no passado → libera lock órfão (auto-release).
//
// Agendada para rodar a cada 5 min. Idempotente e segura: se nada expirou, não faz nada.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Permitir invocação por automação (service) ou admin autenticado.
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const agora = Date.now();
    const nowIso = new Date().toISOString();

    const breakers = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.list('-created_date', 100).catch(() => []);

    const desbloqueados = [];
    const locksLiberados = [];
    const aindaBloqueados = [];

    for (const c of breakers) {
      const updates = {};

      // ── Regra 1 e 2: desbloqueio preciso por tempo ──
      // BLINDAGEM (item 2): SÓ desbloqueia quando o prazo `bloqueado_ate` que o PRÓPRIO Omie
      // pediu ("Tente novamente em N segundos") JÁ EXPIROU. Nunca antes — desbloquear durante
      // o castigo faz a próxima chamada bater no 425 e reabrir (loop vicioso).
      if (c.bloqueado) {
        const ate = c.bloqueado_ate ? new Date(c.bloqueado_ate).getTime() : null;
        if (ate && ate <= agora) {
          // Cooldown que o Omie pediu terminou → seguro desbloquear.
          updates.bloqueado = false;
          updates.bloqueado_ate = null;
          updates.erros_consecutivos = 0;
          updates.ultimo_erro = null;
          desbloqueados.push({ id: c.id, chave: c.chave, expirou_em: c.bloqueado_ate });
        } else {
          // Ainda dentro da janela (ate futuro) OU bloqueio SEM prazo → NUNCA desbloqueia
          // automaticamente. Sem prazo = exige ação manual (evita liberar cego no meio do castigo).
          aindaBloqueados.push({ id: c.id, chave: c.chave, bloqueado_ate: c.bloqueado_ate || 'sem_prazo (requer desbloqueio manual)' });
        }
      }

      // ── Regra 3: libera lock de worker órfão (expirado) ──
      if (c.worker_rodando) {
        const lockAte = c.worker_lock_ate ? new Date(c.worker_lock_ate).getTime() : null;
        if (!lockAte || lockAte <= agora) {
          updates.worker_rodando = false;
          updates.worker_lock_ate = null;
          locksLiberados.push({ id: c.id, chave: c.chave });
        }
      }

      if (Object.keys(updates).length > 0) {
        updates.atualizado_em = nowIso;
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, updates).catch(() => null);
      }
    }

    return Response.json({
      sucesso: true,
      executado_em: nowIso,
      desbloqueados_count: desbloqueados.length,
      desbloqueados,
      locks_liberados_count: locksLiberados.length,
      locks_liberados: locksLiberados,
      ainda_bloqueados_count: aindaBloqueados.length,
      ainda_bloqueados: aindaBloqueados
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});