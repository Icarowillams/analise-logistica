import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any, tentativa = 1) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  // FONTE DE VERDADE = Secrets do backend (o app_secret não fica mais no banco).
  let appSecret = Deno.env.get('OMIE_APP_SECRET') || '';
  let appKey = Deno.env.get('OMIE_APP_KEY') || '';
  if (!appKey) {
    const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    appKey = rows?.[0]?.app_key || '';
  }
  // Retry: se ainda sem credenciais e é a primeira tentativa, espera 2s e tenta de novo
  if ((!appKey || !appSecret) && tentativa < 3) {
    await new Promise(r => setTimeout(r, 2000));
    return getOmieCredentials(base44, tentativa + 1);
  }
  if (appKey && appSecret) {
    _credsCache = { appKey, appSecret, at: Date.now() };
  }
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

// ID fixo do único registro de circuit breaker — NUNCA criar novos
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

// ── Slot ATÔMICO de faturamento (chave separada por método) ──
// Causa raiz do "consumo redundante / REDUNDANT / Client-6": o Omie trava 2 FaturarPedidoVenda/
// EmitirNF muito próximos. O throttle global de 1,5s das consultas é pouco para faturar. Aqui
// reservamos um slot futuro persistente, com intervalo de 5s SÓ para os métodos de faturamento,
// usando o mesmo mecanismo de reserva de slot do rate_limit_global, mas em chave separada — assim
// não desacelera as demais chamadas (que seguem 1,5s).
const FAT_SLOT_KEY = 'rate_limit_faturamento';
const FAT_SLOT_INTERVAL_MS = 5000;   // 5s entre faturamentos
const FAT_SLOT_LOCK_MS = 8000;       // validade do mutex curto (auto-release)
const FAT_SLOT_WAIT_CAP_MS = 60000;  // teto de espera por slot
const FAT_METHODS = new Set(['FaturarPedidoVenda', 'EmitirNFS', 'EmitirNF']);

async function getFatSlotRow(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: FAT_SLOT_KEY }, 'created_date', 50).catch(() => []);
  if (!rows?.[0]?.id) {
    const created = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: FAT_SLOT_KEY, atualizado_em: new Date().toISOString() }).catch(() => null);
    return created?.id ? created : null;
  }
  for (const extra of rows.slice(1)) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.delete(extra.id).catch(() => null);
  }
  return rows[0];
}

// Reserva atômica de slot de faturamento, espaçando FaturarPedidoVenda/EmitirNF em 5s entre si
// — mesmo entre processos paralelos (lote + faturamento manual).
async function reservarSlotFaturamento(base44) {
  try {
    const row = await getFatSlotRow(base44);
    if (!row?.id) return;
    const lockId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let gotLock = false;
    for (let i = 0; i < 12; i++) {
      const fresh = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: row.id }, '-created_date', 1).catch(() => []);
      const cur = fresh?.[0];
      const lockedUntil = cur?.worker_lock_ate ? new Date(cur.worker_lock_ate).getTime() : 0;
      if (!lockedUntil || lockedUntil <= Date.now()) {
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(row.id, {
          worker_lock_ate: new Date(Date.now() + FAT_SLOT_LOCK_MS).toISOString(),
          ultimo_erro: lockId
        }).catch(() => null);
        const confirm = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: row.id }, '-created_date', 1).catch(() => []);
        if (confirm?.[0]?.ultimo_erro === lockId) { gotLock = true; break; }
      }
      await sleep(250 + Math.floor(Math.random() * 250));
    }
    const fresh = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: row.id }, '-created_date', 1).catch(() => []);
    const cur = fresh?.[0] || row;
    const proximoSlot = cur?.atualizado_em ? new Date(cur.atualizado_em).getTime() : 0;
    const now = Date.now();
    const meuSlot = Math.max(now, proximoSlot);
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(row.id, {
      atualizado_em: new Date(meuSlot + FAT_SLOT_INTERVAL_MS).toISOString(),
      ...(gotLock ? { worker_lock_ate: null } : {})
    }).catch(() => null);
    const espera = Math.min(meuSlot - now, FAT_SLOT_WAIT_CAP_MS);
    if (espera > 0) await sleep(espera);
  } catch { /* nunca bloqueia a chamada */ }
}

function extrairSegundosBloqueio(msg) {
  const match = String(msg).match(/(\d+)\s*segundo/i);
  if (match) return Math.min(Number(match[1]), 1800);
  return 300; // fallback 5 minutos
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  // FATURAMENTO: espaça FaturarPedidoVenda/EmitirNF em 5s entre si (slot atômico persistente,
  // chave separada). É a defesa na ORIGEM contra o "consumo redundante" — Omie trava 2 muito próximos.
  if (FAT_METHODS.has(call)) await reservarSlotFaturamento(base44);
  // SEM retries automáticos para emissão de NF — cada retry consome cota.
  // Se falhar por rate limit, o circuit breaker protege o restante do lote.
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 20000);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
    clearTimeout(tid);
    // Erro HTTP do Omie (5xx/429/425): corpo não costuma ser JSON. SEM retry (cada retry consome cota) —
    // propaga erro estruturado; o circuit breaker protege o restante do lote.
    if (res.status >= 500 || res.status === 429 || res.status === 425) {
      const corpo = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`);
      if (res.status === 425) {
        const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
        const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
        const _p: any = { erros_consecutivos: _erros, ultimo_erro: err.message.slice(0, 500), atualizado_em: new Date().toISOString() };
        if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
        err.bloqueio = true;
      } else {
        err.rateLimit = true;
      }
      throw err;
    }
    const data = await res.json();
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
        { const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null); }
        const err = new Error(data.faultstring);
        err.bloqueio = true;
        throw err;
      }
      // CONSUMO REDUNDANTE (REDUNDANT / Client-6): o slot de 5s já previne na origem. Se mesmo
      // assim vier, faz RETRY SILENCIOSO com backoff maior — reserva novo slot e refaz a chamada,
      // sem propagar o texto cru. Até 3 tentativas; depois propaga como transitório (vira "pendente").
      if (msg.includes('redundante') || String(data.faultcode || '').toLowerCase().includes('client-6')) {
        const tentativaRed = (options._tentativaRedundante || 0) + 1;
        if (tentativaRed <= 3 && FAT_METHODS.has(call)) {
          const segs = Number(String(data.faultstring).match(/(\d+)\s*segundo/i)?.[1] || 0);
          const backoff = Math.max(segs * 1000, 6000 * tentativaRed); // 6s, 12s, 18s (ou o tempo do Omie)
          await sleep(backoff);
          return await omieCall(base44, endpoint, param, { ...options, _tentativaRedundante: tentativaRed });
        }
        const err = new Error(data.faultstring);
        err.faultstring = data.faultstring;
        err.faultcode = data.faultcode || '';
        err.omiePayload = data;
        err.rateLimit = true; // transitório → "Aguardando emissão no Omie", nunca erro
        throw err;
      }
      // Rate limit suave (429/cota/aguarde) — NÃO faz retry, apenas propaga erro com flag
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite')) {
        const err = new Error(data.faultstring);
        err.faultstring = data.faultstring;
        err.faultcode = data.faultcode || '';
        err.omiePayload = data;
        err.rateLimit = true;
        throw err;
      }
      const err = new Error(data.faultstring);
      err.faultstring = data.faultstring;
      err.faultcode = data.faultcode || '';
      err.omiePayload = data;
      throw err;
    }
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
    return data;
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Timeout na chamada Omie');
    throw e;
  }
}
// ═══ fim omieClient inline ═══

const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Teto de espera ao aguardar uma janela de bloqueio/rate limit do circuit breaker no início do lote.
const TETO_ESPERA_MS = 90 * 1000;

// Identifica erro TRANSITÓRIO (vale retry: rate limit, bloqueio temporário, timeout, HTTP 5xx).
// NÃO é dado inválido — esses devem ser reprocessados, não descartados.
function isTransitorio(error) {
  if (error?.bloqueio || error?.rateLimit) return true;
  const code = String(error?.faultcode || '').toLowerCase();
  // SOAP-ENV:Client-6 / faultcode 6 = consumo redundante do Omie → transitório, NUNCA erro terminal.
  if (code.includes('client-6') || code === '6' || code.endsWith('-6')) return true;
  const m = String(error?.message || error?.faultstring || '').toLowerCase();
  return m.includes('425') || m.includes('429') || m.includes('http 5') ||
    m.includes('timeout') || m.includes('consumo indevido') || m.includes('consumo redundante') ||
    m.includes('bloqueada') || m.includes('bloqueio') || m.includes('cota') || m.includes('aguarde') ||
    m.includes('redundante') || m.includes('limite') || m.includes('misuse');
}

// IDEMPOTÊNCIA: já existe NF para este pedido? (espelho 60+NF, Pedido local, log autorizado).
// Evita re-emitir nota duplicada em retries. Leitura local apenas (sem chamar a Omie).
async function jaPossuiNf(base44, codigoPedido) {
  const codigo = String(codigoPedido);
  const esp = (await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: codigo }, '-updated_date', 1).catch(() => []))?.[0];
  if (esp?.etapa === '60' && esp?.numero_nf) return { possui: true, numero_nf: esp.numero_nf };
  const ped = (await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigo }, '-updated_date', 1).catch(() => []))?.[0];
  if (ped?.numero_nota_fiscal) return { possui: true, numero_nf: ped.numero_nota_fiscal };
  const log = (await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: codigo, status: 'autorizada' }, '-created_date', 1).catch(() => []))?.[0];
  if (log?.numero_nf) return { possui: true, numero_nf: log.numero_nf };
  return { possui: false };
}

// Limpa lixo: itens da fila presos em "executando" há mais de 15 min → marca como erro (expirado),
// liberando a fila e deixando os pendentes visíveis para reprocessamento.
async function limparExecucoesPresas(base44) {
  const limite = Date.now() - 15 * 60 * 1000;
  const presos = await base44.asServiceRole.entities.FilaEmissaoNF.filter({ status: 'executando' }, '-created_date', 50).catch(() => []);
  for (const f of presos) {
    const ref = new Date(f.atualizado_em || f.iniciado_em || f.created_date).getTime();
    if (ref < limite) {
      await base44.asServiceRole.entities.FilaEmissaoNF.update(f.id, {
        status: 'erro',
        mensagem: 'Lote expirado (preso em execução há mais de 15 min). Pendentes liberados para reprocessamento.',
        atualizado_em: new Date().toISOString(),
        concluido_em: new Date().toISOString()
      }).catch((e) => { console.error('[processarEmissaoNFLote] falha ao expirar lote preso:', e?.message || e); });
    }
  }
}

function formatarDataBrasilia(isoDate) {
  return new Date(isoDate).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function criarErroOmie(data, fallback = 'Erro Omie') {
  const error = new Error(data?.faultstring || fallback);
  error.faultstring = data?.faultstring || fallback;
  error.faultcode = data?.faultcode || '';
  error.omiePayload = data || null;
  return error;
}

// ── Confirmação da NF via StatusPedido (ConsultarPedido) ──
// CHAVE: "sucesso" do FaturarPedidoVenda só significa que o Omie ACEITOU o pedido — NÃO que
// a NF saiu. A NF só está realmente emitida quando faturada=S / etapa 60 / ListaNfe com nNF.
// StatusPedido aceita codigo_pedido (ListarNF não). Retorna o estado real classificado.
// Confirmação SÍNCRONA e rápida: esperamos a NF real de cada pedido, mas com backoff CURTO e
// crescente em vez de ritmo fixo lento. A maioria das NFs autoriza em 2-4s; checar cedo e parar
// no instante em que confirmar economiza o tempo ocioso, sem deixar de esperar a NF de verdade.
// A precisão é a mesma (só resolve com NF confirmada); apenas não desperdiça espera à toa.
const TENTATIVAS_CONFIRMA = 6;          // re-consultas do StatusPedido após faturar (cobre SEFAZ lenta)
// Backoff crescente por tentativa (ms): 3s, 4s, 5s, 6s, 8s, 10s — total ~36s só se a SEFAZ demorar muito.
const ESPERAS_CONFIRMA_MS = [3000, 4000, 5000, 6000, 8000, 10000];
// Espaçamento entre pedidos = 0. O throttle global atômico (omieCall) já serializa as chamadas
// em ~1,5s; um delay fixo extra aqui só dobra a lentidão (ex.: 42s perdidos em 14 pedidos) sem
// proteger nada. O circuit breaker continua cobrindo rajada/rate limit.
const DELAY_ENTRE_PEDIDOS_MS = 0;

// Lê o status real do pedido no Omie. Resolve só com NF confirmada (etapa>=60 / faturada=S / nNF);
// rejeição SEFAZ (cStat>=200) vira "rejeitada" com motivo; etapa<60 sem NF = "aguardando".
async function consultarStatusPedido(base44, codigoPedido) {
  let pedido;
  try {
    const r = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigoPedido) }, { call: 'ConsultarPedido' });
    pedido = r?.pedido_venda_produto || r || {};
  } catch (e) {
    if (e.bloqueio || e.rateLimit) throw e; // transitório → o chamador trata como "ainda processando"
    return { erro: e.message };
  }
  const cab = pedido.cabecalho || {};
  const infoCad = pedido.infoCadastro || pedido.info_cadastro || {};
  const infoNfe = pedido.infoNfe || pedido.info_nf || pedido.informacoes_nfe || {};
  const etapa = String(cab.etapa || '');
  const etapaNum = Number(etapa) || 0;
  const faturada = String(infoCad.faturado || infoNfe.faturado || '').toUpperCase();
  const nNF = infoNfe.nNF || infoNfe.numero_nf || cab.numero_nfe || cab.numero_nf || infoCad.nNumeroNFe || infoCad.numero_nfe || '';
  const cStat = String(infoNfe.cStat || infoNfe.cStatus || '');
  const xMotivo = infoNfe.xMotivo || infoNfe.cMensStatus || infoNfe.motivo || '';

  // Rejeição real da SEFAZ
  if (cStat && Number(cStat) >= 200 && !['100', '150', '101', '135'].includes(cStat)) {
    return { etapa, status_real: 'rejeitada', codigo_sefaz: cStat, numero_nf: '', mensagem: `NF rejeitada [SEFAZ ${cStat}]${xMotivo ? ' — ' + xMotivo : ''}` };
  }
  // NF emitida e autorizada
  if (nNF || etapaNum >= 60 || faturada === 'S') {
    return { etapa, status_real: 'emitida', codigo_sefaz: cStat || '100', numero_nf: String(nNF || ''), mensagem: nNF ? `NF ${nNF} autorizada` : 'NF autorizada (etapa 60)' };
  }
  // Etapa < 60, sem NF, faturada=N → SEFAZ ainda processando
  return { etapa, status_real: 'aguardando', numero_nf: '', mensagem: `Pedido em etapa ${etapa || '?'} — aguardando autorização da SEFAZ` };
}

// Aplica o resultado confirmado: atualiza Pedido local, espelho e log.
async function aplicarResultadoConfirmado(base44, codigoPedido, real) {
  if (real.status_real === 'emitida') {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []);
    const p = pedidos?.[0];
    if (p?.id) {
      await base44.asServiceRole.entities.Pedido.update(p.id, {
        status: 'faturado', status_faturamento: 'faturado', faturado: true,
        pendente_emissao: false, nf_aguardando_autorizacao: false, motivo_pendencia_emissao: '', omie_erro: '',
        ...(p.data_faturamento ? {} : { data_faturamento: new Date().toISOString() }),
        ...(real.numero_nf ? { numero_nota_fiscal: real.numero_nf } : {})
      }).catch((e) => { console.error('[processarEmissaoNFLote] falha ao marcar pedido faturado:', e?.message || e); });
    }
  }
  // Espelho PedidoLiberadoOmie
  try {
    const esp = (await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1).catch(() => []))?.[0];
    if (esp) {
      await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
        etapa: real.etapa || esp.etapa,
        status_real: real.status_real,
        status_label: real.mensagem,
        numero_nf: real.numero_nf || esp.numero_nf || '',
        sincronizado_em: new Date().toISOString(),
        origem_sync: 'reconciliacao'
      }).catch((e) => { console.error('[processarEmissaoNFLote] falha ao atualizar espelho (confirmado):', e?.message || e); });
    }
  } catch { /* ignore */ }
}


async function buscarContextoPedido(base44, codigoPedido) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) });
    const p = pedidos?.[0];
    if (!p) return {};
    return {
      pedido_id: p.id,
      numero_pedido: p.numero_pedido || '',
      cliente_id: p.cliente_id || '',
      cliente_nome: p.cliente_nome || '',
      carga_id: p.carga_id || '',
      numero_carga: p.numero_carga || ''
    };
  } catch {
    return {};
  }
}

async function gravarLogEmissao(base44, fila, codigoPedido, status, mensagem, extra = {}) {
  // CORREÇÃO: evitar duplicatas — se já existe log "pendente" para este pedido, atualiza em vez de criar novo
  if (status === 'pendente') {
    const existentes = await base44.asServiceRole.entities.LogEmissaoNF.filter(
      { codigo_pedido: String(codigoPedido), status: 'pendente' }, '-created_date', 1
    ).catch(() => []);
    if (existentes?.[0]) {
      await base44.asServiceRole.entities.LogEmissaoNF.update(existentes[0].id, {
        lote_id: fila.lote_id,
        mensagem,
        usuario_email: fila.usuario_email || ''
      }).catch(() => {});
      return;
    }
  }

  const ctx = await buscarContextoPedido(base44, codigoPedido);
  await base44.asServiceRole.entities.LogEmissaoNF.create({
    codigo_pedido: String(codigoPedido),
    numero_pedido: ctx.numero_pedido,
    cliente_id: ctx.cliente_id,
    cliente_nome: ctx.cliente_nome,
    carga_id: ctx.carga_id || fila.carga_id || '',
    numero_carga: ctx.numero_carga || fila.numero_carga || '',
    lote_id: fila.lote_id,
    status,
    mensagem,
    faultstring: extra.faultstring || '',
    faultcode: extra.faultcode || '',
    erro_tipo: extra.erro_tipo || '',
    payload_enviado: extra.payload_enviado || '',
    payload_resposta: extra.payload_resposta || '',
    boleto_gerado: false,
    usuario_email: fila.usuario_email || ''
  }).catch(() => {});
}

async function carregarFila(base44, body) {
  const filaId = body.fila_id || body.data?.id || body.event?.entity_id;
  if (filaId) {
    try {
      const fila = await base44.asServiceRole.entities.FilaEmissaoNF.get(filaId);
      if (fila && ['processando', 'executando'].includes(fila.status)) return fila;
    } catch { /* segue para buscar próxima */ }
  }
  const filas = await base44.asServiceRole.entities.FilaEmissaoNF.filter({ status: 'processando' }, '-created_date', 1);
  return filas?.[0] || null;
}

// Verifica o circuit breaker persistente. Se estiver bloqueado e o prazo ainda
// não expirou, retorna o status; se expirou, desbloqueia o registro existente.
async function verificarCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const ctrl = rows?.[0];
  if (!ctrl?.bloqueado) return { bloqueado: false };
  const bloqueadoAte = ctrl.bloqueado_ate ? new Date(ctrl.bloqueado_ate).getTime() : 0;
  if (bloqueadoAte > Date.now()) return { bloqueado: true, bloqueado_ate: ctrl.bloqueado_ate };
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
  return { bloqueado: false };
}

// Valida se o código de pedido é numérico e maior que zero (evita pedidos fake/teste).
function codigoPedidoValido(codigo) {
  const n = Number(codigo);
  return Number.isFinite(n) && n > 0 && /^\d+$/.test(String(codigo).trim());
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    // Limpa lixo: lotes presos em "executando" há +15min (ex.: travados desde 09-15/06).
    await limparExecucoesPresas(base44);

    const fila = await carregarFila(base44, body);

    if (!fila) {
      return Response.json({ sucesso: true, mensagem: 'Nenhum lote pendente para processar' });
    }

    // 1) Circuit breaker no INÍCIO: bloqueio é transitório, não parada geral. Em vez de abortar o lote,
    // aguarda a janela bloqueado_ate (com teto) e segue — o breaker continua protegendo contra rajada,
    // mas o lote respeita a janela e retoma. Se a espera passar do teto, devolve a fila p/ pendente.
    const breaker = await verificarCircuitBreaker(base44);
    if (breaker.bloqueado) {
      const esperaMs = breaker.bloqueado_ate ? new Date(breaker.bloqueado_ate).getTime() - Date.now() : 0;
      if (esperaMs > 0 && esperaMs <= TETO_ESPERA_MS) {
        await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
          mensagem: `API Omie bloqueada — aguardando ${Math.round(esperaMs / 1000)}s para retomar o lote...`,
          atualizado_em: new Date().toISOString()
        }).catch(() => {});
        await sleep(esperaMs);
      } else {
        await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
          status: 'pendente',
          mensagem: 'API Omie bloqueada por rate limit — aguardando desbloqueio (lote será retomado)',
          atualizado_em: new Date().toISOString()
        }).catch(() => {});
        return Response.json(
          { error: 'API Omie bloqueada por rate limit', bloqueado_ate: breaker.bloqueado_ate },
          { status: 425 }
        );
      }
    }

    // Dedup defensiva — nunca processa o mesmo pedido 2x na mesma rodada (evita CÓDIGO 6 redundante)
    const pedidos = Array.isArray(fila.pedidos) ? [...new Set(fila.pedidos.map(String).filter(Boolean))] : [];
    const resultados = Array.isArray(fila.resultados) ? [...fila.resultados] : [];
    const erros = Array.isArray(fila.erros) ? [...fila.erros] : [];
    let processados = Number(fila.processados || 0);

    await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
      status: 'executando',
      mensagem: `Emitindo NF ${Math.min(processados + 1, pedidos.length)} de ${pedidos.length}...`,
      atualizado_em: new Date().toISOString()
    });

    for (let i = processados; i < pedidos.length; i++) {
      const codigoPedido = pedidos[i];
      const t0 = Date.now();

      // Valida o código ANTES de chamar a Omie. Pedido fake/não numérico é pulado com log.
      if (!codigoPedidoValido(codigoPedido)) {
        const msg = `Código de pedido inválido (não numérico): "${codigoPedido}" — ignorado, Omie não foi chamada.`;
        resultados.push({ codigo_pedido: codigoPedido, sucesso: false, status: 'ignorado', mensagem: msg });
        erros.push({ codigo_pedido: codigoPedido, mensagem: msg });
        await gravarLogEmissao(base44, fila, codigoPedido, 'ignorado', msg, { erro_tipo: 'validacao' });
        processados = i + 1;
        await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, { processados, resultados, erros, atualizado_em: new Date().toISOString() }).catch(() => {});
        continue;
      }

      // BLINDAGEM FISCAL: nunca emitir NF de pedido solto manualmente ou que não está numa carga ativa.
      const pedidoLocalGuard = (await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []))?.[0];
      if (pedidoLocalGuard && (pedidoLocalGuard.solto_manualmente === true || !pedidoLocalGuard.carga_id)) {
        const msgBloqueio = pedidoLocalGuard.solto_manualmente === true
          ? `Pedido #${pedidoLocalGuard.numero_pedido || codigoPedido} foi solto manualmente — emissão de NF bloqueada (só por ação humana em carga ativa).`
          : `Pedido #${pedidoLocalGuard.numero_pedido || codigoPedido} não está em carga ativa — emissão de NF bloqueada.`;
        resultados.push({ codigo_pedido: codigoPedido, sucesso: false, status: 'ignorado', mensagem: msgBloqueio });
        erros.push({ codigo_pedido: codigoPedido, mensagem: msgBloqueio });
        await gravarLogEmissao(base44, fila, codigoPedido, 'ignorado', msgBloqueio, { erro_tipo: 'validacao' });
        processados = i + 1;
        await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, { processados, resultados, erros, atualizado_em: new Date().toISOString() }).catch(() => {});
        continue;
      }

      // IDEMPOTÊNCIA: se já há NF para este pedido (retry após sucesso parcial), PULA — não duplica nota.
      const nfExistente = await jaPossuiNf(base44, codigoPedido);
      if (nfExistente.possui) {
        resultados.push({ codigo_pedido: codigoPedido, sucesso: true, status: 'ja_emitida', mensagem: `NF ${nfExistente.numero_nf} já existe — pulado.` });
        await gravarLogEmissao(base44, fila, codigoPedido, 'autorizada', `NF ${nfExistente.numero_nf} já existia — não re-emitida.`, { faultstring: '' }).catch(() => {});
        processados = i + 1;
        await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, { processados, resultados, erros, atualizado_em: new Date().toISOString() }).catch(() => {});
        continue;
      }

      // ── EMITIR LENTO E CONFIRMAR CADA PEDIDO ──
      // 1) StatusPedido ANTES: etapa 60/NF já existe → só grava autorizada (anti-duplicidade).
      // 2) Etapa 50 sem NF → FaturarPedidoVenda (Omie só ACEITA aqui).
      // 3) Confirma em laço espaçado (StatusPedido) até faturada=S/NF → autorizada;
      //    rejeição SEFAZ → erro com motivo real; ainda etapa 50 → pendente honesto.
      // Circuit breaker + slot (omieCall) antes de CADA chamada.
      let statusFinalPedido = null; // 'autorizada' | 'rejeitada' | 'pendente' | 'erro'
      let realConfirmado = null;
      let mensagemPedido = '';
      let erroPedido = null;
      let transitorioPedido = false;

      try {
        // (1) Estado real ANTES de faturar — não refatura quem já tem NF.
        let real = await consultarStatusPedido(base44, codigoPedido);

        if (real?.erro) {
          // Falha de consulta (não é rate limit): mantém pendente honesto, mensagem limpa.
          statusFinalPedido = 'pendente';
          mensagemPedido = 'Aguardando emissão no Omie — será confirmado automaticamente.';
        } else if (real.status_real === 'emitida') {
          // Já estava emitida (etapa 60 / faturada=S) — anti-dup: só grava autorizada.
          statusFinalPedido = 'autorizada';
          realConfirmado = real;
          mensagemPedido = real.mensagem;
        } else if (real.status_real === 'rejeitada') {
          statusFinalPedido = 'rejeitada';
          realConfirmado = real;
          mensagemPedido = real.mensagem;
        } else {
          // (2) Etapa 50 sem NF → aciona a emissão.
          let respFat = null;
          if (body.mock_omie_response) {
            console.log(`[processarEmissaoNFLote] MOCK Omie usado para pedido ${codigoPedido}; nenhuma emissão real realizada`);
          } else {
            respFat = await omieCall(base44, 'produtos/pedidovendafat/', { nCodPed: Number(codigoPedido) }, { call: 'FaturarPedidoVenda' });
          }

          // RECUSA DO OMIE no faturamento: HTTP 200 com cCodStatus != "0" e mensagem de bloqueio
          // (ex: "Cliente com o cadastro bloqueado para faturar"). NÃO é NF — é rejeição.
          // Marca como rejeitada (motivo real) e o loop segue para o PRÓXIMO pedido.
          {
            const cCod = String(respFat?.cCodStatus ?? '').trim();
            const cDesc = String(respFat?.cDescStatus ?? '');
            const temNf = respFat?.nNF || respFat?.numero_nf || respFat?.cChaveNFe || respFat?.chave_nfe;
            if (!temNf && cCod && cCod !== '0' && /n[ãa]o foi poss[íi]vel|bloquead|bloqueio|recusad|n[ãa]o.*faturar|inadimpl/i.test(cDesc)) {
              statusFinalPedido = 'rejeitada';
              realConfirmado = { status_real: 'rejeitada', codigo_sefaz: cCod, numero_nf: '', mensagem: cDesc };
              mensagemPedido = cDesc;
            }
          }
          if (statusFinalPedido === 'rejeitada') {
            // pula a confirmação — já sabemos que foi recusado
          } else {
          await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'produtos/pedidovendafat', call: 'FaturarPedidoVenda',
            operacao: 'emitir_nf_lote_background', status: 'sucesso', duracao_ms: Date.now() - t0,
            payload_enviado: JSON.stringify({ nCodPed: codigoPedido }).slice(0, 800),
            usuario_email: fila.usuario_email || ''
          }).catch(() => {});

          // (3) Confirma em laço de backoff CURTO: "sucesso" do faturar ≠ NF emitida.
          // Para no INSTANTE em que a NF confirma — não espera o teto à toa.
          for (let c = 0; c < TENTATIVAS_CONFIRMA; c++) {
            const espera = ESPERAS_CONFIRMA_MS[c] ?? ESPERAS_CONFIRMA_MS[ESPERAS_CONFIRMA_MS.length - 1];
            await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
              mensagem: `Confirmando NF do pedido ${i + 1}/${pedidos.length} (tentativa ${c + 1}/${TENTATIVAS_CONFIRMA})...`,
              atualizado_em: new Date().toISOString()
            }).catch(() => {});
            await sleep(espera);
            const conf = await consultarStatusPedido(base44, codigoPedido);
            if (conf?.erro) continue; // tenta de novo na próxima volta
            if (conf.status_real === 'emitida') { statusFinalPedido = 'autorizada'; realConfirmado = conf; mensagemPedido = conf.mensagem; break; }
            if (conf.status_real === 'rejeitada') { statusFinalPedido = 'rejeitada'; realConfirmado = conf; mensagemPedido = conf.mensagem; break; }
            // segue 'aguardando' → tenta de novo
          }
          if (!statusFinalPedido) {
            // Esgotou as tentativas e continua na etapa 50 → pendente HONESTO (não é erro nem rate limit).
            statusFinalPedido = 'pendente';
            mensagemPedido = 'Faturado na carga — aguardando autorização da SEFAZ (etapa 50). Será confirmado na próxima emissão.';
          }
          } // fim do else (não foi recusa do Omie)
        }
      } catch (error) {
        erroPedido = error;
        transitorioPedido = isTransitorio(error);
        // Transitório (rate limit/425/timeout) → pendente reprocessável; erro de dado → erro real.
        statusFinalPedido = transitorioPedido ? 'pendente' : 'erro';
        // Transitório → mensagem LIMPA para o operador (sem "redundante/REDUNDANT/Client-6/ocupado").
        mensagemPedido = transitorioPedido
          ? 'Aguardando emissão no Omie — será confirmado automaticamente.'
          : (error.faultstring || `Erro: ${error.message || 'falha na emissão'}`);
      }

      // ── Aplica o resultado confirmado (Pedido local + espelho + log) ──
      if (statusFinalPedido === 'autorizada') {
        if (realConfirmado) await aplicarResultadoConfirmado(base44, codigoPedido, realConfirmado);
        resultados.push({ codigo_pedido: codigoPedido, sucesso: true, status: 'autorizada', numero_nf: realConfirmado?.numero_nf || '', mensagem: mensagemPedido });
        await gravarLogEmissao(base44, fila, codigoPedido, 'autorizada', mensagemPedido, {
          faultstring: '', faultcode: realConfirmado?.codigo_sefaz || '100'
        });
      } else if (statusFinalPedido === 'rejeitada') {
        if (realConfirmado) await aplicarResultadoConfirmado(base44, codigoPedido, realConfirmado);
        const pedRej = (await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []))?.[0];
        if (pedRej?.id) await base44.asServiceRole.entities.Pedido.update(pedRej.id, { status_faturamento: 'rejeitado', omie_erro: mensagemPedido }).catch((e) => { console.error('[processarEmissaoNFLote] falha ao marcar pedido rejeitado:', e?.message || e); });
        resultados.push({ codigo_pedido: codigoPedido, sucesso: false, status: 'rejeitada', mensagem: mensagemPedido });
        erros.push({ codigo_pedido: codigoPedido, mensagem: mensagemPedido });
        await gravarLogEmissao(base44, fila, codigoPedido, 'rejeitada', mensagemPedido, {
          faultcode: realConfirmado?.codigo_sefaz || '', erro_tipo: 'sefaz'
        });
      } else if (statusFinalPedido === 'erro') {
        const pedErr = (await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []))?.[0];
        if (pedErr?.id) await base44.asServiceRole.entities.Pedido.update(pedErr.id, { status_faturamento: 'erro', omie_erro: mensagemPedido }).catch((e) => { console.error('[processarEmissaoNFLote] falha ao marcar pedido com erro de faturamento:', e?.message || e); });
        resultados.push({ codigo_pedido: codigoPedido, sucesso: false, status: 'erro', mensagem: mensagemPedido });
        erros.push({ codigo_pedido: codigoPedido, mensagem: mensagemPedido });
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: 'produtos/pedidovendafat', call: 'FaturarPedidoVenda', operacao: 'emitir_nf_lote_background',
          status: erroPedido?.faultstring ? 'erro_omie' : 'erro', codigo_erro: erroPedido?.faultcode || '',
          duracao_ms: Date.now() - t0, mensagem_erro: mensagemPedido,
          erro_detalhado: erroPedido?.faultstring || mensagemPedido,
          payload_enviado: JSON.stringify({ nCodPed: codigoPedido }).slice(0, 2000),
          payload_resposta: erroPedido?.omiePayload ? JSON.stringify(erroPedido.omiePayload).slice(0, 5000) : '',
          usuario_email: fila.usuario_email || ''
        }).catch(() => {});
        await gravarLogEmissao(base44, fila, codigoPedido, 'erro', mensagemPedido, {
          faultstring: erroPedido?.faultstring || '', faultcode: erroPedido?.faultcode || '',
          erro_tipo: erroPedido?.faultstring ? 'omie' : 'interno',
          payload_enviado: JSON.stringify({ nCodPed: codigoPedido }).slice(0, 2000),
          payload_resposta: erroPedido?.omiePayload ? JSON.stringify(erroPedido.omiePayload).slice(0, 5000) : ''
        });
      } else {
        // pendente honesto (etapa 50 não confirmou ou transitório)
        const pedPend = (await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []))?.[0];
        if (pedPend?.id) await base44.asServiceRole.entities.Pedido.update(pedPend.id, {
          status_faturamento: 'processando',
          pendente_emissao: true,
          // FLAG da rede de segurança: reconciliarNfAguardandoAutorizacao filtra por este campo.
          // Sem isto, o pedido faturado no Omie (etapa 50→60 assíncrono) ficava órfão e o
          // número da NF nunca era capturado pelo app — causa do "0 confirmadas / N aguardando".
          nf_aguardando_autorizacao: true,
          motivo_pendencia_emissao: mensagemPedido
        }).catch((e) => { console.error('[processarEmissaoNFLote] falha ao marcar pedido pendente de emissão:', e?.message || e); });
        resultados.push({ codigo_pedido: codigoPedido, sucesso: false, status: 'pendente', mensagem: mensagemPedido });
        await gravarLogEmissao(base44, fila, codigoPedido, 'pendente', mensagemPedido);
      }

      processados = i + 1;
      await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
        processados,
        resultados,
        erros,
        mensagem: processados < pedidos.length ? `Emitindo NF ${processados + 1} de ${pedidos.length}...` : 'Finalizando emissão...',
        atualizado_em: new Date().toISOString()
      });

      // Espaçamento GENEROSO entre pedidos — emite lento de propósito (confirma cada um).
      if (i < pedidos.length - 1) await sleep(DELAY_ENTRE_PEDIDOS_MS);
    }

    // Conta resultados confirmados: autorizadas, pendentes honestos (SEFAZ ainda processando).
    const autorizadas = resultados.filter(r => r.status === 'autorizada' || r.status === 'ja_emitida').length;
    const pendentesHonestos = resultados.filter(r => !r.sucesso && r.status === 'pendente').length;
    const statusFinal = erros.length > 0 ? 'erro' : 'concluido';
    let mensagemFinal;
    if (statusFinal === 'concluido' && pendentesHonestos > 0) {
      mensagemFinal = `${autorizadas} NF(s) confirmada(s). ${pendentesHonestos} ainda aguardando autorização da SEFAZ (etapa 50).`;
    } else if (statusFinal === 'concluido') {
      mensagemFinal = `${autorizadas} NF(s) emitida(s) e confirmada(s).`;
    } else {
      mensagemFinal = `${erros.length} pedido(s) falharam${pendentesHonestos > 0 ? ` e ${pendentesHonestos} aguardando a SEFAZ` : ''}.`;
    }
    await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
      status: statusFinal,
      processados,
      resultados,
      erros,
      mensagem: mensagemFinal,
      atualizado_em: new Date().toISOString(),
      concluido_em: new Date().toISOString()
    });

    return Response.json({ sucesso: statusFinal === 'concluido', fila_id: fila.id, status: statusFinal, processados, autorizadas, erros: erros.length, pendentes: pendentesHonestos });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});