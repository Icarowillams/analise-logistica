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
    const fila = await carregarFila(base44, body);

    if (!fila) {
      return Response.json({ sucesso: true, mensagem: 'Nenhum lote pendente para processar' });
    }

    // 1) Circuit breaker: se a API Omie estiver bloqueada, NÃO processa nada.
    // Devolve a fila para 'pendente' (pra ser retomada depois) e retorna 425.
    const breaker = await verificarCircuitBreaker(base44);
    if (breaker.bloqueado) {
      await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
        status: 'pendente',
        mensagem: 'API Omie bloqueada por rate limit — aguardando desbloqueio',
        atualizado_em: new Date().toISOString()
      }).catch(() => {});
      return Response.json(
        { error: 'API Omie bloqueada por rate limit', bloqueado_ate: breaker.bloqueado_ate },
        { status: 425 }
      );
    }

    const pedidos = Array.isArray(fila.pedidos) ? fila.pedidos.map(String).filter(Boolean) : [];
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

      try {
        const resposta = body.mock_omie_response || await omieCall(base44, 'produtos/pedidovendafat/', { nCodPed: Number(codigoPedido) }, { call: 'FaturarPedidoVenda' });
        if (body.mock_omie_response) console.log(`[processarEmissaoNFLote] MOCK Omie usado para pedido ${codigoPedido}; nenhuma emissão real realizada`);
        resultados.push({
          codigo_pedido: codigoPedido,
          sucesso: true,
          status: 'pendente_sefaz',
          mensagem: 'Emissão acionada no Omie — aguardando retorno da SEFAZ'
        });

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
      } catch (error) {
        const mensagem = error.message || 'Erro ao emitir NF';
        resultados.push({ codigo_pedido: codigoPedido, sucesso: false, status: 'erro', mensagem });
        const pedidosLocaisErro = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []);
        if (pedidosLocaisErro?.[0]?.id) {
          await base44.asServiceRole.entities.Pedido.update(pedidosLocaisErro[0].id, { status_faturamento: 'erro', omie_erro: mensagem }).catch(() => {});
        }
        erros.push({ codigo_pedido: codigoPedido, mensagem });

        const payloadEnviado = JSON.stringify({ nCodPed: codigoPedido });
        const payloadResposta = error.omiePayload ? JSON.stringify(error.omiePayload) : '';
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: 'produtos/pedidovendafat',
          call: 'FaturarPedidoVenda',
          operacao: 'emitir_nf_lote_background',
          status: error.faultstring ? 'erro_omie' : 'erro',
          codigo_erro: error.faultcode || '',
          duracao_ms: Date.now() - t0,
          mensagem_erro: mensagem,
          erro_detalhado: error.faultstring || `Erro interno: ${mensagem}`,
          payload_enviado: payloadEnviado.slice(0, 2000),
          payload_resposta: payloadResposta.slice(0, 5000),
          usuario_email: fila.usuario_email || ''
        }).catch(() => {});

        await gravarLogEmissao(base44, fila, codigoPedido, 'erro', error.faultstring || `Erro interno: ${mensagem}`, {
          faultstring: error.faultstring || '',
          faultcode: error.faultcode || '',
          erro_tipo: error.faultstring ? 'omie' : 'interno',
          payload_enviado: payloadEnviado.slice(0, 2000),
          payload_resposta: payloadResposta.slice(0, 5000)
        });

        if (mensagem.toLowerCase().includes('bloqueada') || mensagem.toLowerCase().includes('bloqueio')) {
          processados = i + 1;
          await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
            processados,
            resultados,
            erros,
            status: 'erro',
            mensagem: `Processamento interrompido: ${mensagem}`,
            atualizado_em: new Date().toISOString(),
            concluido_em: new Date().toISOString()
          });
          return Response.json({ sucesso: false, fila_id: fila.id, erro: mensagem, processados });
        }
      }

      processados = i + 1;
      await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
        processados,
        resultados,
        erros,
        mensagem: processados < pedidos.length ? `Emitindo NF ${processados + 1} de ${pedidos.length}...` : 'Finalizando emissão...',
        atualizado_em: new Date().toISOString()
      });

      // Delay entre emissões para respeitar rate limit do Omie
      if (i < pedidos.length - 1) await sleep(12000);
    }

    const statusFinal = erros.length > 0 ? 'erro' : 'concluido';
    await base44.asServiceRole.entities.FilaEmissaoNF.update(fila.id, {
      status: statusFinal,
      processados,
      resultados,
      erros,
      mensagem: statusFinal === 'concluido' ? 'Lote enviado ao Omie. Aguardando retorno da SEFAZ nos logs.' : `${erros.length} pedido(s) falharam na emissão.`,
      atualizado_em: new Date().toISOString(),
      concluido_em: new Date().toISOString()
    });

    return Response.json({ sucesso: statusFinal === 'concluido', fila_id: fila.id, status: statusFinal, processados, erros: erros.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});