import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Retorna o estado atual do circuit breaker Omie (leitura rápida, sem chamar API Omie)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ID fixo do ÚNICO registro de circuit breaker — mesma fonte da verdade do _shared/omieClient.
    // (Antes lia por chave:'principal', registro que ninguém bloqueia → painel mostrava "liberado"
    //  mesmo com o breaker real bloqueado.)
    const CB_FIXED_ID = '6a1e06a9aa62ceab7b3b6d97';
    const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter(
      { id: CB_FIXED_ID }, '-created_date', 1
    ).catch(() => []);
    const ctrl = rows?.[0];

    if (!ctrl) {
      return Response.json({
        bloqueado: false,
        tipo: 'OK',
        bloqueado_ate: null,
        tempo_restante_segundos: 0,
        ultimo_erro: null,
        atualizado_em: null
      });
    }

    const agora = Date.now();
    const bloqueadoAte = ctrl.bloqueado_ate ? new Date(ctrl.bloqueado_ate).getTime() : 0;
    const bloqueado = ctrl.bloqueado && bloqueadoAte > agora;
    const tempoRestante = bloqueado ? Math.max(0, Math.ceil((bloqueadoAte - agora) / 1000)) : 0;

    // Se expirou, desbloqueia automaticamente
    if (ctrl.bloqueado && !bloqueado) {
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(ctrl.id, {
        bloqueado: false,
        atualizado_em: new Date().toISOString()
      }).catch(() => {});
    }

    // Detecta tipo de bloqueio pelo último erro
    let tipo = 'OK';
    if (bloqueado) {
      const erro = (ctrl.ultimo_erro || '').toLowerCase();
      if (erro.includes('misuse') || erro.includes('consumo indevido')) {
        tipo = 'MISUSE';
      } else if (erro.includes('429') || erro.includes('cota') || erro.includes('rate') || erro.includes('limite')) {
        tipo = 'RATE_LIMIT';
      } else {
        tipo = 'BLOQUEADO';
      }
    }

    return Response.json({
      bloqueado,
      tipo,
      bloqueado_ate: bloqueado ? ctrl.bloqueado_ate : null,
      tempo_restante_segundos: tempoRestante,
      ultimo_erro: ctrl.ultimo_erro || null,
      atualizado_em: ctrl.atualizado_em || null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});