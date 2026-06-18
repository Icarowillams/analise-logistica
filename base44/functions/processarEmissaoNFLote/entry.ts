import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any, tentativa = 1) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || '';
  let appSecret = cfg?.app_secret || '';
  // Fallback para variáveis de ambiente
  if (!appKey || !appSecret) {
    appKey = Deno.env.get('OMIE_APP_KEY') || '';
    appSecret = Deno.env.get('OMIE_APP_SECRET') || '';
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
      // Rate limit suave (429/cota/aguarde) — NÃO faz retry, apenas propaga erro com flag
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite')) {
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

// Espaçamento entre cada emissão (igual trocarEtapaPedidoOmie) para não estourar o anti-flood.
const DELAY_ENTRE_EMISSOES_MS = 1800;
// Retry por pedido em caso de erro transitório (rate limit / 425 / 429 / 500 / redundante).
const MAX_RETRY_TRANSITORIO = 3;
// Teto de espera ao aguardar uma janela de bloqueio/rate limit.
const TETO_ESPERA_MS = 90 * 1000;

// Identifica erro TRANSITÓRIO (vale retry: rate limit, bloqueio temporário, timeout, HTTP 5xx).
// NÃO é dado inválido — esses devem ser reprocessados, não descartados.
function isTransitorio(error) {
  if (error?.bloqueio || error?.rateLimit) return true;
  const m = String(error?.message || '').toLowerCase();
  return m.includes('425') || m.includes('429') || m.includes('http 5') ||
    m.includes('timeout') || m.includes('consumo indevido') || m.includes('bloqueada') ||
    m.includes('bloqueio') || m.includes('cota') || m.includes('aguarde') ||
    m.includes('redundante') || m.includes('limite') || m.includes('misuse');
}

// Quanto esperar (ms) antes de retomar o MESMO pedido após erro transitório.
async function calcularEsperaMs(base44, error) {
  // Se o breaker abriu por bloqueio, respeita a janela bloqueado_ate (com teto).
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const ctrl = rows?.[0];
  if (ctrl?.bloqueado && ctrl.bloqueado_ate) {
    const ms = new Date(ctrl.bloqueado_ate).getTime() - Date.now();
    if (ms > 0) return Math.min(ms, TETO_ESPERA_MS);
  }
  const seg = extrairSegundosBloqueio(error?.message || '');
  return Math.min(seg * 1000, TETO_ESPERA_MS);
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
      }).catch(() => {});
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

      // Emite com retry resiliente: erro transitório (rate limit/425/timeout/5xx) NÃO descarta o pedido —
      // aguarda a janela sugerida (com teto) e RETOMA o MESMO pedido. Só vira erro após esgotar as tentativas.
      let emitido = false;
      let ultimoErro = null;
      for (let tentativa = 0; tentativa < MAX_RETRY_TRANSITORIO && !emitido; tentativa++) {
        try {
          const resposta = body.mock_omie_response || await omieCall(base44, 'produtos/pedidovendafat/', { nCodPed: Number(codigoPedido) }, { call: 'FaturarPedidoVenda' });
          if (body.mock_omie_response) console.log(`[processarEmissaoNFLote] MOCK Omie usado para pedido ${codigoPedido}; nenhuma emissão real realizada`);
          resultados.push({ codigo_pedido: codigoPedido, sucesso: true, status: 'pendente_sefaz', mensagem: 'Emissão acionada no Omie — aguardando retorno da SEFAZ' });

          const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []);
          if (pedidosLocais?.[0]?.id) {
            await base44.asServiceRole.entities.Pedido.update(pedidosLocais[0].id, { status_faturamento: 'processando' }).catch(() => {});
          }

          await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'produtos/pedidovendafat',
            call: 'FaturarPedidoVenda',
            operacao: 'emitir_nf_lote_background',
            status: 'sucesso',
            duracao_ms: Date.now() - t0,
            payload_enviado: JSON.stringify({ nCodPed: codigoPedido }).slice(0, 800),
            payload_resposta: JSON.stringify(resposta).slice(0, 800),
            usuario_email: fila.usuario_email || ''
          }).catch(() => {});

          await gravarLogEmissao(base44, fila, codigoPedido, 'pendente', 'Emissão acionada no Omie — aguardando retorno da SEFAZ');
          emitido = true;
        } catch (error) {
          ultimoErro = error;
          // Erro transitório → aguarda a janela e retoma o MESMO pedido (não descarta os seguintes).
          if (isTransitorio(error) && tentativa < MAX_RETRY_TRANSITORIO - 1) {
            const esperaMs = await calcularEsperaMs(base44, error);
            await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
              mensagem: `Omie ocupado (rate limit) no pedido ${i + 1}/${pedidos.length} — aguardando ${Math.round(esperaMs / 1000)}s e retomando...`,
              atualizado_em: new Date().toISOString()
            }).catch(() => {});
            await sleep(esperaMs);
            continue;
          }
          // Esgotou as tentativas (ou erro definitivo de dado): registra. Transitório fica como PENDENTE
          // (reprocessável no Log de Emissão); erro real de dado fica como ERRO.
          break;
        }
      }

      if (!emitido) {
        const error = ultimoErro || new Error('Erro ao emitir NF');
        const mensagem = error.message || 'Erro ao emitir NF';
        const transitorio = isTransitorio(error);
        const statusLog = transitorio ? 'pendente' : 'erro';

        resultados.push({ codigo_pedido: codigoPedido, sucesso: false, status: statusLog, mensagem });
        // Pendente transitório NÃO entra em "erros" definitivos — fica para reprocessar sem sumir.
        if (!transitorio) erros.push({ codigo_pedido: codigoPedido, mensagem });

        const pedidosLocaisErro = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []);
        if (pedidosLocaisErro?.[0]?.id) {
          await base44.asServiceRole.entities.Pedido.update(pedidosLocaisErro[0].id, {
            status_faturamento: transitorio ? 'pendente' : 'erro',
            omie_erro: mensagem
          }).catch(() => {});
        }

        const payloadEnviado = JSON.stringify({ nCodPed: codigoPedido });
        const payloadResposta = error.omiePayload ? JSON.stringify(error.omiePayload) : '';
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: 'produtos/pedidovendafat',
          call: 'FaturarPedidoVenda',
          operacao: 'emitir_nf_lote_background',
          status: error.faultstring ? 'erro_omie' : (transitorio ? 'warning' : 'erro'),
          codigo_erro: error.faultcode || '',
          duracao_ms: Date.now() - t0,
          mensagem_erro: mensagem,
          erro_detalhado: error.faultstring || `Erro interno: ${mensagem}`,
          payload_enviado: payloadEnviado.slice(0, 2000),
          payload_resposta: payloadResposta.slice(0, 5000),
          usuario_email: fila.usuario_email || ''
        }).catch(() => {});

        await gravarLogEmissao(base44, fila, codigoPedido, statusLog,
          transitorio ? `Omie ocupado (rate limit) — não emitida ainda, reprocessar. ${mensagem}` : (error.faultstring || `Erro interno: ${mensagem}`), {
          faultstring: error.faultstring || '',
          faultcode: error.faultcode || '',
          erro_tipo: error.faultstring ? 'omie' : (transitorio ? 'transitorio' : 'interno'),
          payload_enviado: payloadEnviado.slice(0, 2000),
          payload_resposta: payloadResposta.slice(0, 5000)
        });
      }

      processados = i + 1;
      await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
        processados,
        resultados,
        erros,
        mensagem: processados < pedidos.length ? `Emitindo NF ${processados + 1} de ${pedidos.length}...` : 'Finalizando emissão...',
        atualizado_em: new Date().toISOString()
      });

      // Espaçamento entre emissões para respeitar o anti-flood do Omie (~1800ms).
      if (i < pedidos.length - 1) await sleep(DELAY_ENTRE_EMISSOES_MS);
    }

    // Pendentes transitórios (rate limit) não são erro definitivo — ficam listados no Log de Emissão
    // para reprocessar em 1 clique, sem sumir silenciosamente.
    const pendentesTransitorios = resultados.filter(r => !r.sucesso && r.status === 'pendente').length;
    const statusFinal = erros.length > 0 ? 'erro' : 'concluido';
    let mensagemFinal;
    if (statusFinal === 'concluido' && pendentesTransitorios > 0) {
      mensagemFinal = `Lote enviado ao Omie. ${pendentesTransitorios} pedido(s) ficaram pendentes por rate limit — reprocesse no Log de Emissão.`;
    } else if (statusFinal === 'concluido') {
      mensagemFinal = 'Lote enviado ao Omie. Aguardando retorno da SEFAZ nos logs.';
    } else {
      mensagemFinal = `${erros.length} pedido(s) falharam na emissão${pendentesTransitorios > 0 ? ` e ${pendentesTransitorios} ficaram pendentes para reprocessar` : ''}.`;
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

    return Response.json({ sucesso: statusFinal === 'concluido', fila_id: fila.id, status: statusFinal, processados, erros: erros.length, pendentes: pendentesTransitorios });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});