import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════════════
// corrigirEspelho20Falso — ROTINA PONTUAL, SOB CLIQUE (admin-only). NÃO é automação.
//
// Reconsulta no Omie os pedidos do espelho (PedidoLiberadoOmie) gravados em etapa 20
// via webhook (gravação otimista antiga) e, onde o Omie REAL disser etapa 10 (ou outra
// diferente de 20), corrige o espelho para a etapa real. Resolve o "falso liberado".
//
// SEGURO: sequencial, com delay entre chamadas, respeita o circuit breaker (se bloqueado,
// aborta na hora — não martela). Idempotente (rodar de novo não causa dano).
// LEITURA pura no Omie (ConsultarPedido) — nunca fatura nem altera nada no Omie.
// ═══════════════════════════════════════════════════════════════════════════

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';
const DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _credsCache = null;
async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
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

async function registrarErroBreaker(base44, faultstring) {
  const segs = (() => { const m = String(faultstring).match(/(\d+)\s*segundo/i); return m ? Math.min(Number(m[1]), 1800) : 0; })();
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const cb = rows?.[0];
  const erros = (cb?.erros_consecutivos || 0) + 1;
  const thresh = cb?.threshold_erros ?? 3;
  const p = { erros_consecutivos: erros, ultimo_erro: String(faultstring).slice(0, 500), atualizado_em: new Date().toISOString() };
  if (erros >= thresh && segs > 0) { p.bloqueado = true; p.bloqueado_ate = new Date(Date.now() + segs * 1000).toISOString(); }
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, p).catch(() => null);
}

// Consulta a etapa real do pedido no Omie. Retorna string da etapa, ou null.
async function consultarEtapaReal(base44, codigoPedido) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(OMIE_BASE_URL + 'produtos/pedido/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ConsultarPedido', app_key: appKey, app_secret: appSecret, param: [{ codigo_pedido: Number(codigoPedido) }] }),
      signal: controller.signal
    });
    clearTimeout(tid);
    if (res.status === 425 || res.status === 429) {
      const corpo = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 120) : ''}`);
      err.rateLimit = true;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      if (/consumo indevido|bloquead|425|cota|limite|redundante/.test(msg)) {
        const err = new Error(data.faultstring);
        err.rateLimit = true;
        throw err;
      }
      // pedido não encontrado / outro fault — devolve null (sem etapa)
      return null;
    }
    return String(data?.pedido_venda_produto?.cabecalho?.etapa || data?.cabecalho?.etapa || '') || null;
  } finally {
    clearTimeout(tid);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });

    // Respeita o breaker — se bloqueado, nem começa.
    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) {
      return Response.json({ sucesso: false, bloqueado: true, bloqueado_ate: cb.blockedUntil, mensagem: `API Omie bloqueada até ${cb.blockedUntil}. Tente novamente quando liberar.` });
    }

    // Carrega TODO o espelho em etapa 20 gravado via webhook (os suspeitos de "falso liberado").
    const candidatos = [];
    let skip = 0;
    while (true) {
      const lote = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ etapa: '20', origem_sync: 'webhook' }, '-sincronizado_em', 500, skip).catch(() => []);
      if (!lote || lote.length === 0) break;
      candidatos.push(...lote);
      if (lote.length < 500) break;
      skip += 500;
    }

    let corrigidos = 0;
    let confirmados20 = 0;
    let semEtapa = 0;
    let abortado = false;
    const correcoes = [];

    for (let i = 0; i < candidatos.length; i++) {
      const esp = candidatos[i];
      if (!esp.codigo_pedido) { semEtapa++; continue; }
      try {
        const etapaReal = await consultarEtapaReal(base44, esp.codigo_pedido);
        if (!etapaReal) {
          semEtapa++;
        } else if (etapaReal === '20') {
          // Confirmado: realmente está liberado. Só carimba sincronizado_em.
          confirmados20++;
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, { sincronizado_em: new Date().toISOString(), origem_sync: 'correcao_pontual' }).catch(() => {});
        } else {
          // Divergente (ex: Omie real = 10) — corrige o espelho para a etapa real.
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
            etapa: etapaReal,
            status_label: etapaReal === '10' ? 'Pedido Pendente' : `Etapa ${etapaReal}`,
            sincronizado_em: new Date().toISOString(),
            origem_sync: 'correcao_pontual'
          });
          corrigidos++;
          correcoes.push({ numero_pedido: esp.numero_pedido, codigo_pedido: esp.codigo_pedido, de: '20', para: etapaReal });
        }
      } catch (e) {
        if (e.rateLimit) {
          await registrarErroBreaker(base44, e.message);
          abortado = true;
          break; // rate limit → para imediatamente, não martela
        }
        // outro erro pontual: ignora este e segue
      }
      if (i < candidatos.length - 1) await sleep(DELAY_MS);
    }

    return Response.json({
      sucesso: true,
      total_candidatos: candidatos.length,
      corrigidos,
      confirmados_20: confirmados20,
      sem_etapa: semEtapa,
      abortado_por_rate_limit: abortado,
      correcoes
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});