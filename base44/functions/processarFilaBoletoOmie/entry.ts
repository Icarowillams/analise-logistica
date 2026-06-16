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

    return Response.json({ sucesso: true, processados, erros, pausado_por_bloqueio: pausadoPorBloqueio, total_fila: fila.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});