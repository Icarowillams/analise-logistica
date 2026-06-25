import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ⚙️ WORKER DE BAIXA PRIORIDADE — FILA DE BOLETOS OMIE
// ─────────────────────────────────────────────────────────────────────────────
// PROBLEMA RAIZ que isto resolve:
//   A geração de boletos era disparada INLINE pelo webhook de faturamento
//   (processarWebhookOmie → gerarBoletoAuto). Numa rajada de faturamento, isso
//   virava N gerações simultâneas, cada uma com ListarContasReceber + GerarBoleto
//   a ~1 chamada/segundo → estourava a cota global da Omie → webhooks de NF e
//   ConsultarPedido recebiam "Rate limit exceeded" e o circuit breaker auto-bloqueava.
//
// SOLUÇÃO:
//   O webhook agora só ENFILEIRA (FilaBoletoOmie). Este worker roda AGENDADO
//   (a cada 5 min) e processa a fila UM PEDIDO POR VEZ, espaçado, com PRIORIDADE
//   BAIXA: se houver webhooks pendentes ou o circuit breaker estiver ativo, ele
//   CEDE A VEZ e deixa pra próxima rodada. Boleto nunca compete com NF/webhook.
//
// Reusa gerarBoletosOmie (origem=auto) que já faz dedup + delays internos por título.

const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

// Quantos pedidos processar por execução (cada um pode gerar vários boletos internamente).
const MAX_POR_RODADA = 8;
// Delay REAL entre pedidos — boleto é baixa prioridade, pode ser lento de propósito.
const DELAY_ENTRE_PEDIDOS_MS = 2500;
// Backoff quando um item falha por rate limit/redundante (não é erro definitivo).
const BACKOFF_RATE_LIMIT_MS = 5 * 60 * 1000; // 5 min
const MAX_TENTATIVAS = 5;
const CHAVE_WORKER_BOLETO = 'worker_boleto'; // chave DEDICADA do lock de auto-encadeamento da fila de boletos
const LOCK_TTL_MS = 2 * 60 * 1000;           // TTL curto do lock — auto-release se a função morrer

// ============================================================
// LOCK DE AUTO-ENCADEAMENTO — garante 1 cadeia por vez.
// Registro dedicado (chave='worker_boleto') com worker_rodando + worker_lock_ate.
// TTL curto evita travamento permanente se a função morrer.
// ============================================================
async function adquirirLockEncadeamento(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ chave: CHAVE_WORKER_BOLETO }, '-updated_date', 1).catch(() => []);
  const reg = rows?.[0];
  const agora = Date.now();
  const lockAtivo = reg?.worker_rodando && reg?.worker_lock_ate && new Date(reg.worker_lock_ate).getTime() > agora;
  if (lockAtivo) return { adquirido: false };
  const dados = {
    chave: CHAVE_WORKER_BOLETO,
    worker_rodando: true,
    worker_lock_ate: new Date(agora + LOCK_TTL_MS).toISOString(),
    atualizado_em: new Date().toISOString()
  };
  if (reg) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(reg.id, dados).catch(() => {});
  else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(dados).catch(() => {});
  return { adquirido: true };
}

async function liberarLockEncadeamento(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ chave: CHAVE_WORKER_BOLETO }, '-updated_date', 1).catch(() => []);
  const reg = rows?.[0];
  if (reg) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(reg.id, {
    worker_rodando: false, worker_lock_ate: null, atualizado_em: new Date().toISOString()
  }).catch(() => {});
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

function isRateLimit(msg) {
  const m = String(msg || '').toLowerCase();
  return m.includes('425') || m.includes('429') || m.includes('consumo indevido') ||
    m.includes('bloqueada') || m.includes('bloqueio') || m.includes('cota') ||
    m.includes('aguarde') || m.includes('redundante') || m.includes('limite') || m.includes('misuse');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Admin autenticado OU automação (service role, sem usuário).
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // PRIORIDADE 1 — circuit breaker: se a Omie está bloqueada, nem começa.
    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) {
      return Response.json({ sucesso: false, motivo: 'circuit_breaker_ativo', bloqueado_ate: cb.blockedUntil, processados: 0 });
    }

    // ═══ LOCK "1 CADEIA POR VEZ" — adquirido no INÍCIO, segurado por TODO o
    // processamento e liberado no fim (try/finally). TTL ~2min é a rede de
    // segurança se a função morrer. Cadeia ativa (worker_rodando + lock futuro) → skipped.
    const lock = await adquirirLockEncadeamento(base44);
    if (!lock.adquirido) {
      console.log('[FILA BOLETO] Lock ativo — outra cadeia já está processando. Skipped.');
      return Response.json({ sucesso: true, mensagem: 'Lock ativo (1 cadeia por vez)', skipped: 'lock', processados: 0 });
    }

    try {

    // PRIORIDADE 2 — webhooks/NF vêm ANTES de boletos. Se há webhook pendente na fila,
    // cede a vez: o worker de webhooks (alta prioridade) deve esvaziar antes.
    const webhookPendente = await base44.asServiceRole.entities.LogIntegracaoOmie.filter(
      { endpoint: 'webhook', status: 'pendente' }, 'created_date', 1
    ).catch(() => []);
    if (webhookPendente.length > 0) {
      return Response.json({ sucesso: true, processados: 0, motivo: 'cedendo_prioridade_para_webhooks' });
    }

    // Busca itens pendentes (mais antigos primeiro).
    const agora = Date.now();
    const candidatos = await base44.asServiceRole.entities.FilaBoletoOmie.filter(
      { status: 'pendente' }, 'created_date', MAX_POR_RODADA * 3
    ).catch(() => []);

    // Respeita o backoff (proxima_tentativa_em no futuro = pular agora).
    const fila = candidatos.filter(item => {
      if (!item.proxima_tentativa_em) return true;
      return new Date(item.proxima_tentativa_em).getTime() <= agora;
    }).slice(0, MAX_POR_RODADA);

    if (fila.length === 0) {
      return Response.json({ sucesso: true, processados: 0, motivo: 'fila_vazia' });
    }

    let processados = 0;
    let erros = 0;
    let pausadoPorBloqueio = false;

    for (let i = 0; i < fila.length; i++) {
      const item = fila[i];

      // Re-checa o circuit breaker a cada item (outra função pode ter bloqueado no meio).
      const cbMid = await checkCircuitBreaker(base44);
      if (cbMid.blocked) { pausadoPorBloqueio = true; break; }

      await base44.asServiceRole.entities.FilaBoletoOmie.update(item.id, { status: 'processando' }).catch(() => {});

      // 🛡️ IDEMPOTÊNCIA LOCAL: se o espelho local já indica boleto gerado para este pedido,
      // NÃO chama o Omie (evita ListarContasReceber + GerarBoleto redundantes — maior ofensor do rate limit).
      try {
        const logsBoleto = await base44.asServiceRole.entities.LogEmissaoNF.filter(
          { codigo_pedido: String(item.codigo_pedido) }, '-created_date', 5
        ).catch(() => []);
        if (logsBoleto.some(l => l.boleto_gerado === true)) {
          await base44.asServiceRole.entities.FilaBoletoOmie.update(item.id, {
            status: 'concluido',
            tentativas: Number(item.tentativas || 0) + 1,
            resultado: 'Boleto já gerado (idempotência local) — não chamou Omie',
            processado_em: new Date().toISOString()
          }).catch(() => {});
          processados++;
          continue;
        }
      } catch { /* segue para geração normal se a checagem falhar */ }

      try {
        const res = await base44.asServiceRole.functions.invoke('gerarBoletosOmie', {
          origem: 'auto',
          pedidos: [{ codigo_pedido: String(item.codigo_pedido) }]
        });
        const data = res?.data || {};
        const sucessos = Number(data.sucessos || 0);
        const skips = Number(data.skips || 0);
        const errosBoleto = Number(data.erros || 0);

        // Se a própria geração reportou erro de rate limit, trata como backoff (não erro definitivo).
        const msgResultado = JSON.stringify(data.resultados || []).slice(0, 400);
        if (errosBoleto > 0 && isRateLimit(msgResultado)) {
          await base44.asServiceRole.entities.FilaBoletoOmie.update(item.id, {
            status: 'pendente',
            tentativas: Number(item.tentativas || 0) + 1,
            proxima_tentativa_em: new Date(Date.now() + BACKOFF_RATE_LIMIT_MS).toISOString(),
            resultado: 'Rate limit — reagendado'
          }).catch(() => {});
        } else {
          await base44.asServiceRole.entities.FilaBoletoOmie.update(item.id, {
            status: sucessos > 0 ? 'concluido' : (skips > 0 ? 'skip' : 'concluido'),
            tentativas: Number(item.tentativas || 0) + 1,
            resultado: `${sucessos} gerado(s), ${skips} ignorado(s), ${errosBoleto} erro(s)`,
            processado_em: new Date().toISOString()
          }).catch(() => {});
          // Marca o espelho local como boleto_gerado quando houve sucesso OU já existia (skip por "já gerado") —
          // garante que próximas rodadas/lotes não reprocessem o mesmo pedido (idempotência local).
          if (sucessos > 0 || skips > 0) {
            try {
              const logsMarcar = await base44.asServiceRole.entities.LogEmissaoNF.filter(
                { codigo_pedido: String(item.codigo_pedido) }, '-created_date', 5
              ).catch(() => []);
              for (const l of logsMarcar) {
                if (l.boleto_gerado !== true) {
                  await base44.asServiceRole.entities.LogEmissaoNF.update(l.id, { boleto_gerado: true }).catch(() => {});
                }
              }
            } catch { /* best-effort */ }
          }
          processados++;
        }
      } catch (e) {
        const msg = String(e.message || e);
        const novaTentativa = Number(item.tentativas || 0) + 1;
        if (isRateLimit(msg)) {
          // Rate limit/bloqueio → pausa o restante e reagenda este item.
          await base44.asServiceRole.entities.FilaBoletoOmie.update(item.id, {
            status: 'pendente', tentativas: novaTentativa,
            proxima_tentativa_em: new Date(Date.now() + BACKOFF_RATE_LIMIT_MS).toISOString(),
            resultado: 'Rate limit — reagendado'
          }).catch(() => {});
          pausadoPorBloqueio = true;
          break;
        }
        // Erro real → marca erro (ou pendente com backoff se ainda há tentativas).
        if (novaTentativa < MAX_TENTATIVAS) {
          await base44.asServiceRole.entities.FilaBoletoOmie.update(item.id, {
            status: 'pendente', tentativas: novaTentativa,
            proxima_tentativa_em: new Date(Date.now() + BACKOFF_RATE_LIMIT_MS).toISOString(),
            resultado: msg.slice(0, 300)
          }).catch(() => {});
        } else {
          await base44.asServiceRole.entities.FilaBoletoOmie.update(item.id, {
            status: 'erro', tentativas: novaTentativa, resultado: msg.slice(0, 300), processado_em: new Date().toISOString()
          }).catch(() => {});
          erros++;
        }
      }

      // Delay real entre pedidos (não no último).
      if (i < fila.length - 1) await new Promise(r => setTimeout(r, DELAY_ENTRE_PEDIDOS_MS));
    }

    // ═══ AUTO-ENCADEAMENTO — mata o atraso (mediana 4min/máx 16min) entre lotes.
    // O lock JÁ é nosso (adquirido no início). Se ainda há pendente, o breaker
    // está liberado e NÃO pausamos por bloqueio → re-invoca fire-and-forget e só
    // depois (no finally) libera o lock — sem janela sem dono. Fila vazia /
    // breaker aberto / pausado por bloqueio → não encadeia.
    let encadeou = false;
    if (!pausadoPorBloqueio) {
      const restantes = await base44.asServiceRole.entities.FilaBoletoOmie
        .filter({ status: 'pendente' }, 'created_date', 1).catch(() => []);
      if (restantes.length > 0) {
        const breakerFim = await checkCircuitBreaker(base44);
        if (!breakerFim.blocked) {
          base44.asServiceRole.functions.invoke('processarFilaBoletoOmie', {}).catch(() => {});
          encadeou = true;
          console.log('[FILA BOLETO] Auto-encadeamento disparado — fila ainda tem pendentes.');
        }
      }
    }

    return Response.json({ sucesso: true, processados, erros, encadeou, pausado_por_bloqueio: pausadoPorBloqueio, total_fila: fila.length });

    } finally {
      // Libera o lock SEMPRE ao fim (sucesso, retorno antecipado ou exceção).
      // A re-invocação encadeada adquire o seu próprio lock em seguida.
      await liberarLockEncadeamento(base44).catch(() => {});
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});