import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════════════
// reconciliarEtapasAbertasOmie — REDE DE SEGURANÇA LEVE, DIRIGIDA e ROTATIVA.
//
// O Omie não dispara webhook EtapaAlterada para 100% das transições. Esta função
// é a malha de segurança: consulta pedidos individualmente (ConsultarPedido) e
// corrige a etapa real no espelho (PedidoLiberadoOmie). LEITURA pura — nunca fatura.
//
// ESCOPO (Correção A):
//   ATIVAS (transicionam): 10, 20, 50, 70 → reconciliadas com prioridade, em LOTE
//     rotativo ordenado por sincronizado_em ASC (pega os mais "velhos de checagem" primeiro).
//     Em 2-3 rodadas cobre todos os ativos girando a fila.
//   FINAIS (raramente mudam): 60, 80 → só uma fatia pequena por rodada (incluir_finais),
//     ou TODAS no modo manual.
//   99 = etapa DESFASADA/INCONSISTENTE → entra como candidato a reconciliar (vira ativa).
//
// LOCK (Correção B): chave dedicada em ControleCircuitBreakerOmie. Se já rodando e lock
//   no futuro → { skipped: 'lock' }. Segura via try/finally, TTL ~3min. Respeita o
//   circuit breaker global do Omie (se bloqueado, não consulta).
//
// HTTP 500 "pedido não cadastrado" = pedido REALMENTE excluído/cancelado no Omie →
//   marca etapa 80 (cancelado) no espelho. NÃO é erro fatal.
// ═══════════════════════════════════════════════════════════════════════════

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

// CREDENCIAIS: Environment-First SEM cache. Deno.env é atômico e sem TTL — nunca serve
// uma chave velha. ConfiguracaoOmie só é fallback (pode conter chave ANTIGA → nunca prioriza).
// Removido o _credsCache de 30s por segurança (mesmo env-primeiro, cache pode segurar
// uma chave durante a janela de troca de credencial).
async function getOmieCredentials(base44) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

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

// Resultado: { data } | { naoCadastrado: true } (HTTP 500/não encontrado = excluído no Omie)
async function consultarPedidoOmie(base44, codigoPedido) {
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
      throw new Error(`HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 120) : ''}`);
    }
    // HTTP 500 frequentemente é "pedido não cadastrado" (excluído no Omie). Inspeciona o corpo.
    // O corpo vem como JSON com unicode escapado (n\u00e3o) — parseia para decodificar antes do regex.
    if (res.status >= 500) {
      const corpo = await res.text().catch(() => '');
      let fault = corpo;
      try { fault = JSON.parse(corpo)?.faultstring || corpo; } catch { /* corpo não-JSON: usa cru */ }
      if (/n[ãa]o cadastrad|n[ãa]o encontrad|n[ãa]o localizad|inexistente/i.test(fault)) {
        return { naoCadastrado: true };
      }
      throw new Error(`HTTP ${res.status} Omie${fault ? ': ' + fault.slice(0, 120) : ''}`);
    }
    const data = await res.json();
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      if (msg.includes('não cadastrad') || msg.includes('nao cadastrad') || msg.includes('não encontrad') || msg.includes('nao encontrad') || msg.includes('não localizad') || msg.includes('nao localizad') || msg.includes('inexistente')) {
        return { naoCadastrado: true };
      }
      throw new Error(data.faultstring);
    }
    return { data };
  } finally {
    clearTimeout(tid);
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── LOCK dedicado (mesmo padrão das filas) ──
const LOCK_ID = '6a1e06a9aa62ceab7b3b6d97'; // reusa o registro único do breaker p/ campos de lock
const LOCK_TTL_MS = 3 * 60_000;

async function adquirirLock(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: LOCK_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  const agora = Date.now();
  const lockAte = c?.reconcilia_lock_ate ? new Date(c.reconcilia_lock_ate).getTime() : 0;
  if (c?.reconcilia_rodando && lockAte > agora) {
    return false; // já rodando, lock no futuro → pula
  }
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(LOCK_ID, {
    reconcilia_rodando: true,
    reconcilia_lock_ate: new Date(agora + LOCK_TTL_MS).toISOString()
  }).catch(() => null);
  return true;
}

async function liberarLock(base44) {
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(LOCK_ID, {
    reconcilia_rodando: false,
    reconcilia_lock_ate: new Date(0).toISOString()
  }).catch(() => null);
}

const ETAPAS_ATIVAS = ['10', '20', '50', '70', '99']; // 99 = defasado → reconciliar
const ETAPAS_FINAIS = ['60', '80'];

Deno.serve(async (req) => {
  let lockAdquirido = false;
  let base44;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      modo = 'auto',                 // 'auto' (automação, com lote) | 'manual' (botão, todos os ativos)
      max_lote = 50,                 // teto de consultas por rodada na automação (cabe em ~2 min)
      fatia_finais = 8,              // quantos finais (60/80) incluir por rodada auto
      incluir_finais = true,         // automação inclui pequena fatia de finais
      throttle_ms = 1500
    } = body;
    const t0 = Date.now();

    const { appKey, appSecret } = await getOmieCredentials(base44);
    if (!appKey || !appSecret) {
      return Response.json({ sucesso: false, error: 'Credenciais Omie não configuradas.' }, { status: 500 });
    }

    // Circuit breaker global — se bloqueado, não consulta.
    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) {
      return Response.json({ sucesso: false, bloqueado: true, bloqueado_ate: cb.blockedUntil, error: `API Omie bloqueada até ${cb.blockedUntil}.` }, { status: 200 });
    }

    // LOCK: a cada 2 min não pode sobrepor.
    lockAdquirido = await adquirirLock(base44);
    if (!lockAdquirido) {
      return Response.json({ sucesso: true, skipped: 'lock', mensagem: 'Reconciliação já em andamento — rodada pulada.' });
    }

    // 1. Carrega TODO o espelho (paginado), ordenado por sincronizado_em ASC
    //    para o lote rotativo pegar SEMPRE os mais desatualizados de checagem primeiro.
    const espelho = [];
    let skip = 0;
    const LIMITE = 500;
    while (true) {
      const lote = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('sincronizado_em', LIMITE, skip).catch(() => []);
      if (!lote || lote.length === 0) break;
      espelho.push(...lote);
      if (lote.length < LIMITE) break;
      skip += LIMITE;
      await delay(300);
    }

    // 2. Monta a fila de candidatos conforme o modo.
    const ativos = espelho.filter(e => e.codigo_pedido && ETAPAS_ATIVAS.includes(String(e.etapa)));
    const finais = espelho.filter(e => e.codigo_pedido && ETAPAS_FINAIS.includes(String(e.etapa)));

    let candidatos;
    if (modo === 'manual') {
      // Botão: fatia controlada (max_lote) dos ativos mais desatualizados, para caber no timeout do gateway.
      // Chamadas repetidas giram a fila via sincronizado_em ASC. Finais só se pedido explícito.
      const lotaAtivos = ativos.slice(0, max_lote);
      candidatos = incluir_finais ? [...lotaAtivos, ...finais.slice(0, fatia_finais)] : lotaAtivos;
    } else {
      // Automação: lote rotativo dos ativos + fatia pequena de finais.
      const lotaAtivos = ativos.slice(0, max_lote);
      const lotaFinais = incluir_finais ? finais.slice(0, fatia_finais) : [];
      candidatos = [...lotaAtivos, ...lotaFinais];
    }

    if (candidatos.length === 0) {
      await liberarLock(base44);
      lockAdquirido = false;
      return Response.json({ sucesso: true, candidatos: 0, atualizados: 0, sem_mudanca: 0, cancelados: 0, duracao_ms: Date.now() - t0, motivo: 'nenhum_candidato' });
    }

    // 3. Consulta individual + update de etapa quando divergir.
    let atualizados = 0;
    let semMudanca = 0;
    let cancelados = 0;
    let erros = 0;
    const mudancas = [];
    const errosDetalhe = [];

    for (let i = 0; i < candidatos.length; i++) {
      const esp = candidatos[i];
      try {
        const r = await consultarPedidoOmie(base44, esp.codigo_pedido);

        // Pedido excluído/cancelado no Omie → marca etapa 80 (cancelado).
        if (r.naoCadastrado) {
          if (String(esp.etapa) !== '80') {
            await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
              etapa: '80',
              status_real: 'cancelada',
              status_label: 'Cancelado no Omie',
              sincronizado_em: new Date().toISOString(),
              origem_sync: 'reconciliacao_dirigida'
            });
            cancelados += 1;
            mudancas.push({ numero_pedido: esp.numero_pedido, codigo_pedido: esp.codigo_pedido, de: String(esp.etapa), para: '80' });
          } else {
            // Já estava 80 — só carimba o sincronizado_em para sair da frente da fila.
            await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, { sincronizado_em: new Date().toISOString() }).catch(() => {});
            semMudanca += 1;
          }
          if (i < candidatos.length - 1) await delay(throttle_ms);
          continue;
        }

        const cab = r.data?.pedido_venda_produto?.cabecalho || r.data?.cabecalho || {};
        const etapaReal = String(cab.etapa || '');
        if (!etapaReal) {
          // Sem etapa legível — só carimba para girar a fila.
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, { sincronizado_em: new Date().toISOString() }).catch(() => {});
          semMudanca += 1;
          if (i < candidatos.length - 1) await delay(throttle_ms);
          continue;
        }

        if (etapaReal !== String(esp.etapa)) {
          const patch = { etapa: etapaReal, sincronizado_em: new Date().toISOString(), origem_sync: 'reconciliacao_dirigida' };
          if (etapaReal === '60') {
            const infoNfe = r.data?.pedido_venda_produto?.infoNfe || r.data?.infoNfe || null;
            patch.status_real = 'emitida';
            patch.status_label = 'Faturado';
            const nf = String(infoNfe?.nNF || infoNfe?.numero_nf || cab.numero_nfe || '');
            if (nf) patch.numero_nf = nf;
            if (infoNfe?.dEmiNFe) patch.data_faturamento = infoNfe.dEmiNFe;
          }
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, patch);
          atualizados += 1;
          mudancas.push({ numero_pedido: esp.numero_pedido, codigo_pedido: esp.codigo_pedido, de: String(esp.etapa), para: etapaReal });
        } else {
          // Etapa igual — carimba sincronizado_em para o lote rotativo girar.
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, { sincronizado_em: new Date().toISOString() }).catch(() => {});
          semMudanca += 1;
        }
      } catch (e) {
        erros += 1;
        const msg = String(e.message || '');
        if (errosDetalhe.length < 5) errosDetalhe.push(`${esp.codigo_pedido}: ${msg.slice(0, 120)}`);
        if (/425|429|consumo|bloquead|redundante|cota|limite/i.test(msg)) {
          await registrarErroBreaker(base44, msg);
          break; // rate limit → para imediatamente, não renova o bloqueio
        }
      }
      if (i < candidatos.length - 1) await delay(throttle_ms);
    }

    const duracao = Date.now() - t0;
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'ConsultarPedido',
      operacao: 'reconciliar_etapas_dirigida',
      status: erros > 0 && atualizados === 0 && cancelados === 0 ? 'warning' : 'sucesso',
      duracao_ms: duracao,
      payload_resposta: JSON.stringify({ modo, candidatos: candidatos.length, ativos: ativos.length, finais: finais.length, atualizados, semMudanca, cancelados, erros, mudancas }).slice(0, 2000)
    }).catch(() => {});

    await liberarLock(base44);
    lockAdquirido = false;

    return Response.json({
      sucesso: true,
      modo,
      total_ativos: ativos.length,
      total_finais: finais.length,
      candidatos: candidatos.length,
      atualizados,
      sem_mudanca: semMudanca,
      cancelados,
      erros,
      erros_detalhe: errosDetalhe,
      mudancas,
      duracao_ms: duracao
    });
  } catch (error) {
    if (lockAdquirido && base44) await liberarLock(base44).catch(() => {});
    return Response.json({ sucesso: false, error: error.message }, { status: 500 });
  }
});