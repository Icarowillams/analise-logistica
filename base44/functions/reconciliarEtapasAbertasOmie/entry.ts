import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════════════
// reconciliarEtapasAbertasOmie — REDE DE SEGURANÇA LEVE e DIRIGIDA.
//
// Problema: o Omie não dispara webhook EtapaAlterada para 100% das transições.
// Ex: 2698/2700 já estão em etapa 20 no Omie mas o espelho ainda diz 10, e nenhum
// webhook chegou. Filtrar "Pendente" mostra 14 em vez de 12.
//
// Estratégia (LEITURA pura + update de etapa, nada além):
//   1. Pega os PedidoLiberadoOmie locais com etapa EM ABERTO (default ['10','20']).
//      Etapas 50/60/99 são finais/conferência — não reconciliar.
//   2. ConsultarPedido individual no Omie (1 chamada por candidato, throttle 1,5s).
//   3. Se a etapa real divergir, atualiza SÓ a etapa (e status_real quando faturado).
//
// NÃO mexe: webhook, ListarPedidos, dedup, throttle/breaker. Só corrige os furos.
// ═══════════════════════════════════════════════════════════════════════════

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
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
    if (res.status === 425 || res.status === 429 || res.status >= 500) {
      const corpo = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 120) : ''}`);
    }
    const data = await res.json();
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      if (msg.includes('não encontrado') || msg.includes('nao encontrado') || msg.includes('não localizado') || msg.includes('nao localizado')) {
        return { naoEncontrado: true };
      }
      throw new Error(data.faultstring);
    }
    return { data };
  } finally {
    clearTimeout(tid);
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { etapas_abertas = ['10', '20'], max_candidatos = 80, throttle_ms = 1500 } = body;
    const t0 = Date.now();

    const { appKey, appSecret } = await getOmieCredentials(base44);
    if (!appKey || !appSecret) {
      return Response.json({ sucesso: false, error: 'Credenciais Omie não configuradas.' }, { status: 500 });
    }

    // Aborta cedo se o circuit breaker estiver ativo — não renova bloqueio.
    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) {
      return Response.json({ sucesso: false, bloqueado: true, bloqueado_ate: cb.blockedUntil, error: `API Omie bloqueada até ${cb.blockedUntil}.` }, { status: 200 });
    }

    // 1. Candidatos: registros do espelho com etapa em aberto (paginado).
    const candidatos = [];
    const etapasSet = new Set(etapas_abertas.map(String));
    let skip = 0;
    const LIMITE = 500;
    while (candidatos.length < max_candidatos) {
      const lote = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('-sincronizado_em', LIMITE, skip).catch(() => []);
      if (!lote || lote.length === 0) break;
      for (const e of lote) {
        if (etapasSet.has(String(e.etapa)) && e.codigo_pedido) candidatos.push(e);
        if (candidatos.length >= max_candidatos) break;
      }
      if (lote.length < LIMITE) break;
      skip += LIMITE;
      await delay(400);
    }

    if (candidatos.length === 0) {
      return Response.json({ sucesso: true, candidatos: 0, atualizados: 0, sem_mudanca: 0, nao_encontrados: 0, duracao_ms: Date.now() - t0, motivo: 'nenhum_candidato_etapa_aberta' });
    }

    // 2. Consulta individual + 3. update de etapa quando divergir.
    let atualizados = 0;
    let semMudanca = 0;
    let naoEncontrados = 0;
    let erros = 0;
    const mudancas = [];

    for (let i = 0; i < candidatos.length; i++) {
      const esp = candidatos[i];
      try {
        const r = await consultarPedidoOmie(base44, esp.codigo_pedido);
        if (r.naoEncontrado) { naoEncontrados += 1; continue; }
        const cab = r.data?.pedido_venda_produto?.cabecalho || r.data?.cabecalho || {};
        const etapaReal = String(cab.etapa || '');
        if (!etapaReal) { semMudanca += 1; continue; }

        if (etapaReal !== String(esp.etapa)) {
          const patch = { etapa: etapaReal, sincronizado_em: new Date().toISOString(), origem_sync: 'reconciliacao_dirigida' };
          // Faturado (60): grava status para a coluna refletir corretamente.
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
          semMudanca += 1;
        }
      } catch (e) {
        erros += 1;
        const msg = String(e.message || '');
        if (/425|429|5\d\d|consumo|bloquead|redundante|cota|limite/i.test(msg)) {
          await registrarErroBreaker(base44, msg);
          // Para o loop ao primeiro sinal de rate limit — não insiste para não renovar bloqueio.
          break;
        }
      }
      // Throttle entre consultas (respeita ~1,5s do Omie).
      if (i < candidatos.length - 1) await delay(throttle_ms);
    }

    const duracao = Date.now() - t0;
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'ConsultarPedido',
      operacao: 'reconciliar_etapas_abertas',
      status: erros > 0 && atualizados === 0 ? 'warning' : 'sucesso',
      duracao_ms: duracao,
      payload_resposta: JSON.stringify({ candidatos: candidatos.length, atualizados, semMudanca, naoEncontrados, erros, mudancas }).slice(0, 2000)
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      candidatos: candidatos.length,
      atualizados,
      sem_mudanca: semMudanca,
      nao_encontrados: naoEncontrados,
      erros,
      mudancas,
      duracao_ms: duracao
    });
  } catch (error) {
    return Response.json({ sucesso: false, error: error.message }, { status: 500 });
  }
});