import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════════════
// corrigirEspelho20Falso — ROTINA PONTUAL, SOB CLIQUE (admin-only). NÃO é automação.
//
// Reconsulta no Omie os pedidos do espelho (PedidoLiberadoOmie) cuja etapa DIVERGE do
// status interno do Pedido (não só etapa 20→10) e corrige o espelho para a etapa REAL
// que o Omie confirmar. Cobre TODAS as divergências:
//   - espelho 10 mas Pedido liberado → Omie pode dizer 10 ou 20 (reconsulta resolve)
//   - espelho 20 mas Pedido faturado → Omie deveria dizer 60
//   - espelho 80 mas Pedido montagem → confirma cancelamento ou corrige
// Se o Omie disser 80 (cancelado) OU o pedido não existir mais ("não cadastrado"),
// marca o espelho como 80 E o status interno do Pedido como cancelado.
//
// SEGURO: 1 chamada por vez, espaçada (1,5s), respeita o circuit breaker e o PORTÃO GLOBAL
// (se bloqueado/ocupado, aborta na hora — não martela). Idempotente.
// LEITURA pura no Omie (ConsultarPedido) — nunca fatura nem altera nada no Omie.
// ═══════════════════════════════════════════════════════════════════════════

// Mapa etapa Omie → status interno do Pedido (mesma régua confirmada pelo Paulo).
const ETAPA_PARA_STATUS_PEDIDO = { '10': 'pendente', '20': 'liberado', '50': 'montagem', '60': 'faturado', '70': 'faturado', '80': 'cancelado' };
const STATUS_LABEL_ETAPA = { '10': 'Pedido Pendente', '20': 'Pedido Liberado', '50': 'Faturar', '60': 'Faturado', '70': 'Entregue', '80': 'Cancelado' };

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';
const DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _credsCache = null;
async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  // FONTE DE VERDADE: Secrets do backend (OMIE_APP_KEY/OMIE_APP_SECRET). A entidade
  // ConfiguracaoOmie pode conter um app_secret ANTIGO/mascarado — nunca tem prioridade.
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) { _credsCache = { appKey: envKey, appSecret: envSecret, at: Date.now() }; return _credsCache; }
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = envKey || String(cfg?.app_key || '').trim();
  const appSecret = envSecret || String(cfg?.app_secret || '').trim();
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

// ── PORTÃO ÚNICO GLOBAL (mutex compartilhado entre TODOS os workers Omie) ──
const CHAVE_PORTAO = 'portao_global_omie';
const PORTAO_TTL_MS = 5 * 60 * 1000;
async function adquirirPortaoGlobal(base44, nome) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: CHAVE_PORTAO }, 'created_date', 5).catch(() => []);
  let reg = rows?.[0];
  if (!reg?.id) reg = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: CHAVE_PORTAO, worker_rodando: false, atualizado_em: new Date().toISOString() }).catch(() => null);
  if (!reg?.id) return { adquirido: false };
  const agora = Date.now();
  if (reg.worker_rodando && reg.worker_lock_ate && new Date(reg.worker_lock_ate).getTime() > agora) return { adquirido: false, ocupadoPor: reg.ultimo_erro };
  const donoId = `${nome}-${agora}-${Math.random().toString(36).slice(2, 8)}`;
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(reg.id, { worker_rodando: true, worker_lock_ate: new Date(agora + PORTAO_TTL_MS).toISOString(), ultimo_erro: donoId, atualizado_em: new Date().toISOString() }).catch(() => null);
  const conf = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: reg.id }, '-created_date', 1).catch(() => []);
  if (conf?.[0]?.ultimo_erro !== donoId) return { adquirido: false, ocupadoPor: conf?.[0]?.ultimo_erro };
  return { adquirido: true, donoId, regId: reg.id };
}
async function liberarPortaoGlobal(base44, donoId) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: CHAVE_PORTAO }, 'created_date', 1).catch(() => []);
  const reg = rows?.[0];
  if (!reg?.id) return;
  if (donoId && reg.ultimo_erro && reg.ultimo_erro !== donoId) return;
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(reg.id, { worker_rodando: false, worker_lock_ate: null, ultimo_erro: null, atualizado_em: new Date().toISOString() }).catch(() => null);
}
// PRIORIDADE: há trabalho de OPERAÇÃO pendente (Fila Envio/Carga)? Se sim, esta rotina de
// LEITURA cede a vez (operação na frente, limpeza atrás).
async function temTrabalhoOperacaoPendente(base44) {
  const [envio, carga] = await Promise.all([
    base44.asServiceRole.entities.FilaEnvioPedidoOmie.filter({ status: 'pendente' }, 'created_date', 1).catch(() => []),
    base44.asServiceRole.entities.FilaCargaOmie.filter({ status: 'pendente' }, 'created_date', 1).catch(() => [])
  ]);
  return (envio?.length > 0) || (carga?.length > 0);
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

// Consulta a etapa real do pedido no Omie.
// Retorna { etapa } com a etapa real, ou { naoCadastrado: true } se o Omie disser que o
// pedido não existe mais (tratado como cancelado/80), ou { etapa: null } se indefinido.
// Lança erro com .rateLimit=true em bloqueio/425/429 para o chamador abortar.
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
      // Pedido não cadastrado/não encontrado no Omie → foi excluído/cancelado. Tratar como 80.
      if (/n[ãa]o cadastrad|n[ãa]o encontrad|inexistente|n[ãa]o existe/.test(msg)) {
        return { naoCadastrado: true };
      }
      // Outro fault — etapa indefinida.
      return { etapa: null };
    }
    return { etapa: String(data?.pedido_venda_produto?.cabecalho?.etapa || data?.cabecalho?.etapa || '') || null };
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

    // PRIORIDADE: rotina de LEITURA cede a vez quando há trabalho de OPERAÇÃO pendente
    // (Fila de Envio / Fila de Carga). Operação na frente; limpeza de espelho atrás.
    if (await temTrabalhoOperacaoPendente(base44)) {
      return Response.json({ sucesso: false, cedeu_prioridade: true, mensagem: 'Há pedidos pendentes na Fila de Envio/Carga. A correção de espelho roda quando a operação terminar. Tente novamente em alguns minutos.' });
    }

    // PORTÃO ÚNICO GLOBAL: só toca o Omie se nenhum outro worker estiver tocando agora.
    const portao = await adquirirPortaoGlobal(base44, 'corrige_espelho');
    if (!portao.adquirido) {
      return Response.json({ sucesso: false, portao_ocupado: true, mensagem: 'Outra operação está usando o Omie agora. Tente novamente em alguns instantes.' });
    }

    try {
    // ── Monta os CANDIDATOS DIVERGENTES ──
    // Carrega todo o espelho e, para cada registro, compara a etapa do espelho com o status
    // interno do Pedido. Só entram na fila de reconsulta os que DIVERGEM (espelho não bate
    // com o status que o Pedido carrega) — não martela o Omie com pedidos já coerentes.
    const espelhos = [];
    let skip = 0;
    while (true) {
      const lote = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({}, '-sincronizado_em', 500, skip).catch(() => []);
      if (!lote || lote.length === 0) break;
      espelhos.push(...lote);
      if (lote.length < 500) break;
      skip += 500;
    }

    // Indexa o status interno dos Pedidos por omie_codigo_pedido (1 passada, sem N consultas).
    const pedidoStatusPorCodigo = new Map();
    let skipP = 0;
    while (true) {
      const lote = await base44.asServiceRole.entities.Pedido.filter({ omie_enviado: true }, '-updated_date', 500, skipP).catch(() => []);
      if (!lote || lote.length === 0) break;
      for (const p of lote) {
        if (p.omie_codigo_pedido) pedidoStatusPorCodigo.set(String(p.omie_codigo_pedido).trim(), p);
      }
      if (lote.length < 500) break;
      skipP += 500;
    }

    // Divergência = etapa do espelho mapeia para um status interno diferente do status real do Pedido.
    const candidatos = espelhos.filter((esp) => {
      if (!esp.codigo_pedido) return false;
      const pedido = pedidoStatusPorCodigo.get(String(esp.codigo_pedido).trim());
      if (!pedido) return false;
      const statusEsperado = ETAPA_PARA_STATUS_PEDIDO[String(esp.etapa)];
      if (!statusEsperado) return false; // etapa fora da régua → deixa para reconciliação
      const statusReal = pedido.status;
      // Estados que consideramos equivalentes para não gerar falso-divergente:
      // 'enviado' ~ 'pendente'; 'cancelado_pos_faturamento' ~ 'cancelado'.
      const norm = (s) => (s === 'enviado' ? 'pendente' : s === 'cancelado_pos_faturamento' ? 'cancelado' : s);
      return norm(statusReal) !== norm(statusEsperado);
    });

    let corrigidos = 0;
    let confirmados = 0;
    let cancelados = 0;
    let semEtapa = 0;
    let abortado = false;
    const correcoes = [];

    for (let i = 0; i < candidatos.length; i++) {
      const esp = candidatos[i];
      try {
        const resultado = await consultarEtapaReal(base44, esp.codigo_pedido);

        // Omie diz que o pedido não existe mais → cancelado (80) no espelho E no Pedido.
        if (resultado.naoCadastrado) {
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
            etapa: '80', status_label: STATUS_LABEL_ETAPA['80'],
            sincronizado_em: new Date().toISOString(), origem_sync: 'correcao_pontual'
          }).catch(() => {});
          const pedido = pedidoStatusPorCodigo.get(String(esp.codigo_pedido).trim());
          if (pedido && pedido.status !== 'cancelado' && pedido.status !== 'cancelado_pos_faturamento') {
            await base44.asServiceRole.entities.Pedido.update(pedido.id, {
              status: pedido.faturado || pedido.numero_nota_fiscal ? 'cancelado_pos_faturamento' : 'cancelado',
              cancelado_no_omie: true,
              data_cancelamento: pedido.data_cancelamento || new Date().toISOString(),
              motivo_cancelamento: pedido.motivo_cancelamento || 'Pedido não cadastrado no Omie (correção de espelho)'
            }).catch(() => {});
          }
          cancelados++;
          correcoes.push({ numero_pedido: esp.numero_pedido, codigo_pedido: esp.codigo_pedido, de: String(esp.etapa), para: '80', motivo: 'nao_cadastrado' });
          if (i < candidatos.length - 1) await sleep(DELAY_MS);
          continue;
        }

        const etapaReal = resultado.etapa;
        if (!etapaReal) {
          semEtapa++;
        } else if (String(etapaReal) === String(esp.etapa)) {
          // Omie confirma a etapa que já estava no espelho — divergência era só no status interno.
          confirmados++;
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
            sincronizado_em: new Date().toISOString(), origem_sync: 'correcao_pontual'
          }).catch(() => {});
        } else {
          // Etapa real diverge do espelho → corrige o espelho para a etapa REAL do Omie.
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
            etapa: String(etapaReal),
            status_label: STATUS_LABEL_ETAPA[String(etapaReal)] || `Etapa ${etapaReal}`,
            sincronizado_em: new Date().toISOString(),
            origem_sync: 'correcao_pontual'
          });
          corrigidos++;
          // Se o Omie disser 80 (cancelado), reflete também no status interno do Pedido.
          if (String(etapaReal) === '80') {
            const pedido = pedidoStatusPorCodigo.get(String(esp.codigo_pedido).trim());
            if (pedido && pedido.status !== 'cancelado' && pedido.status !== 'cancelado_pos_faturamento') {
              await base44.asServiceRole.entities.Pedido.update(pedido.id, {
                status: pedido.faturado || pedido.numero_nota_fiscal ? 'cancelado_pos_faturamento' : 'cancelado',
                cancelado_no_omie: true,
                data_cancelamento: pedido.data_cancelamento || new Date().toISOString(),
                motivo_cancelamento: pedido.motivo_cancelamento || 'Cancelado no Omie (correção de espelho)'
              }).catch(() => {});
            }
            cancelados++;
          }
          correcoes.push({ numero_pedido: esp.numero_pedido, codigo_pedido: esp.codigo_pedido, de: String(esp.etapa), para: String(etapaReal) });
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
      total_espelhos: espelhos.length,
      total_candidatos: candidatos.length,
      corrigidos,
      confirmados,
      cancelados,
      sem_etapa: semEtapa,
      abortado_por_rate_limit: abortado,
      correcoes
    });
    } finally {
      // Libera o portão global sempre ao fim (sucesso ou exceção).
      await liberarPortaoGlobal(base44, portao.donoId).catch(() => {});
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});