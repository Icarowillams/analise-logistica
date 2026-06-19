import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 🔄 ATUALIZA logs de emissão NF que ficaram "pendentes" consultando ATIVAMENTE o Omie.
//
// Quando o webhook NFe.NotaAutorizada/Rejeitada não chega (ou demora demais),
// os logs ficam travados em "pendente". Esta função:
//   1. Lista logs LogEmissaoNF com status='pendente'
//   2. Para cada um, chama ConsultarPedido no Omie para descobrir a etapa real
//   3. Se etapa=60 → busca a NF (ListarNF) para pegar cStat e nNF
//   4. Atualiza o log + o espelho PedidoLiberadoOmie com o resultado real
//   5. Se denegada/cancelada → cancela o pedido local; rejeitada comum volta para etapa 50
//   6. Se autorizada → marca boleto_gerado e dispara gerarBoletosOmie em modo auto
//      (apenas para clientes com BOLETO BANCARIO + tipo=venda)
//
// body: { codigos_pedido?: [string] }
// Segurança Omie: processa no máximo 5 logs por execução, apenas últimas 2h, com cache/cooldown de 10min.

const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

// ═══ omieClient inline (mesmo padrão do processarFilaCargaOmie) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache = null;

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = String(cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '').trim();
  let appSecret = String(cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (!appKey || !appSecret) { appKey = (Deno.env.get('OMIE_APP_KEY') || '').trim(); appSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim(); }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

// ID fixo do único registro de circuit breaker — NUNCA criar novos
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

function extrairSegundosBloqueio(msg) {
  const match = String(msg).match(/(\d+)\s*segundo/i);
  if (match) return Math.min(Number(match[1]), 1800);
  return 180;
}

async function omieCall(base44, endpoint, param, options = {}) {
  const breaker = await checkCircuitBreaker(base44);
  if (breaker.blocked) throw new Error(`API Omie bloqueada até ${breaker.blockedUntil || '?'}`);
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [800, 1500, 3000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null); }
          const blockedErr = new Error(data.faultstring);
          blockedErr.bloqueio = true;
          throw blockedErr;
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

function formatarDataBrasilia(isoDate) {
  return new Date(isoDate).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// Classifica uma NF retornada pelo Omie em status_real + mensagem
function classificarNF(nfEncontrada, codigoPedido) {
  if (!nfEncontrada) return null;
  const cStat = String(nfEncontrada.ide?.cStat || nfEncontrada.cStatus || '');
  const numNf = nfEncontrada.ide?.nNF || nfEncontrada.cNumero || '';
  const xMotivo = nfEncontrada.ide?.xMotivo || nfEncontrada.cMotivo || '';

  if (cStat === '100' || cStat === '150') {
    return { status_real: 'emitida', numero_nf: String(numNf), codigo_sefaz: cStat, mensagem: `NF ${numNf} autorizada` };
  }
  if (cStat === '101' || cStat === '135') {
    return { status_real: 'cancelada', numero_nf: String(numNf), codigo_sefaz: cStat, mensagem: `NF ${numNf} cancelada${xMotivo ? ' — ' + xMotivo : ''}` };
  }
  if (['110', '301', '302', '205'].includes(cStat)) {
    return { status_real: 'denegada', codigo_sefaz: cStat, mensagem: `NF denegada (${cStat})${xMotivo ? ' — ' + xMotivo : ''}` };
  }
  if (cStat && Number(cStat) >= 200) {
    return { status_real: 'rejeitada', codigo_sefaz: cStat, mensagem: `NF rejeitada [SEFAZ ${cStat}]${xMotivo ? ' — ' + xMotivo : ''}` };
  }
  if (numNf) {
    return { status_real: 'emitida', numero_nf: String(numNf), codigo_sefaz: cStat || '100', mensagem: `NF ${numNf}` };
  }
  return null;
}

// Consulta a NF de UM pedido via ConsultarNF (endpoint produtos/nfconsultar/, call ConsultarNF).
// ConsultarNF aceita { nIdPedido } e retorna ide.nNF, ide.serie, compl.cChaveNFe, compl.nIdNF.
// Retry único espaçado (3s) em caso de CÓDIGO 6 / "redundante" / "aguarde".
async function consultarNFporPedido(base44, codigoPedido) {
  let tentativa = 0;
  while (tentativa < 2) {
    try {
      const resp = await omieCall(base44, 'produtos/nfconsultar/', {
        nIdPedido: Number(codigoPedido)
      }, { call: 'ConsultarNF', cacheMinutes: 5 });
      const ide = resp?.ide || {};
      const compl = resp?.compl || {};
      const numero = ide.nNF || resp?.cNumero || '';
      if (!numero) return null;
      return {
        numero_nf: String(numero),
        serie: String(ide.serie || ''),
        cStat: String(ide.cStat || compl.cStat || '100'),
        xMotivo: ide.xMotivo || compl.xMotivo || '',
        chave_nfe: compl.cChaveNFe || '',
        id_nf: compl.nIdNF ? String(compl.nIdNF) : ''
      };
    } catch (e) {
      const msg = String(e.message || '').toLowerCase();
      const redundante = msg.includes('redundante') || msg.includes('aguarde') || msg.includes('código 6') || msg.includes('codigo 6');
      if (redundante && tentativa === 0) {
        await new Promise(r => setTimeout(r, 3000));
        tentativa++;
        continue;
      }
      throw e;
    }
  }
  return null;
}

// Consulta etapa atual do pedido no Omie via ConsultarPedido.
// CORREÇÃO: Etapa 60 = faturado. Mesmo sem detalhes de NF na resposta, marca como emitida.
async function consultarStatusReal(base44, codigoPedido, mockOmieResponse = null) {
  let pedido;
  try {
    if (mockOmieResponse) {
      console.log(`[atualizarStatusLogsPendentes] MOCK Omie usado para pedido ${codigoPedido}; nenhuma chamada real realizada`);
      pedido = mockOmieResponse?.pedido_venda_produto || mockOmieResponse || {};
    } else {
      const r = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigoPedido) }, { call: 'ConsultarPedido', cacheMinutes: 5 });
      pedido = r?.pedido_venda_produto || r || {};
    }
  } catch (e) {
    return { erro: e.message };
  }

  const cab = pedido.cabecalho || {};
  const infoCad = pedido.infoCadastro || pedido.info_cadastro || {};
  const infoNfe = pedido.infoNfe || pedido.info_nf || pedido.informacoes_nfe || {};
  const etapa = String(cab.etapa || '');
  const nNF = infoNfe.nNF || infoNfe.numero_nf || cab.numero_nfe || cab.numero_nf || infoCad.nNumeroNFe || infoCad.numero_nfe || '';
  const nf = {
    ide: {
      cStat: infoNfe.cStat || infoNfe.cStatus || '',
      nNF,
      xMotivo: infoNfe.xMotivo || infoNfe.cMensStatus || infoNfe.motivo || ''
    }
  };
  const classificada = classificarNF(nf, codigoPedido);
  if (classificada) return { etapa, ...classificada };

  // CORREÇÃO DEFINITIVA: usar ConsultarNF (aceita nIdPedido) em vez de ListarNF (NÃO aceita nIdPedido).
  // ListarNF com nCodPed/nIdPedido retorna ERROR "Tag [NIDPEDIDO] não faz parte da estrutura" e dispara
  // CÓDIGO 6 ao varrer páginas. ConsultarNF retorna a NF do pedido em UMA única chamada.
  if (etapa === '60') {
    try {
      // Delay entre ConsultarPedido e ConsultarNF — evita 2 chamadas em rajada (gatilho "consumo indevido")
      await new Promise(r => setTimeout(r, 6000));
      const nfData = await consultarNFporPedido(base44, codigoPedido);
      if (nfData?.numero_nf) {
        const classificadaReal = classificarNF(
          { ide: { cStat: nfData.cStat, nNF: nfData.numero_nf, xMotivo: nfData.xMotivo } },
          codigoPedido
        );
        const base = classificadaReal || {
          status_real: 'emitida',
          numero_nf: nfData.numero_nf,
          codigo_sefaz: nfData.cStat || '100',
          mensagem: `NF ${nfData.numero_nf} autorizada`
        };
        // Etapa 60 + NF com número = autorizada. Anexa série e chave.
        return { etapa, ...base, serie_nf: nfData.serie || '', chave_nfe: nfData.chave_nfe || '', id_nf: nfData.id_nf || '' };
      }
    } catch (nfErr) {
      console.warn(`[atualizarStatusLogsPendentes] ConsultarNF falhou para pedido ${codigoPedido}: ${nfErr.message}`);
    }

    // Fallback: ConsultarNF falhou ou não retornou NF — marca como aguardando
    return {
      etapa,
      status_real: 'aguardando',
      numero_nf: nNF || '',
      codigo_sefaz: '',
      mensagem: `Pedido na etapa 60 mas sem NF confirmada pela SEFAZ`
    };
  }
  return { etapa, status_real: 'aguardando', mensagem: `Pedido em etapa ${etapa || '?'} — ainda processando` };
}

async function registrarCooldownConsulta(base44, codigoPedido, valor = {}, minutos = 10) {
  const chave = `${OMIE_PEDIDO_URL}|ConsultarPedido|${JSON.stringify({ codigo_pedido: Number(codigoPedido) })}`;
  const payloadCache = {
    chave,
    valor,
    tipo: `ConsultarPedido:${codigoPedido}`,
    expira_em: new Date(Date.now() + minutos * 60000).toISOString(),
    criado_em: new Date().toISOString()
  };
  const existente = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
  if (existente?.[0]?.id) await base44.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payloadCache).catch(() => {});
  else await base44.asServiceRole.entities.CacheOmieConsulta.create(payloadCache).catch(() => {});
}

async function consultadoRecentemente(base44, codigoPedido) {
  const chave = `${OMIE_PEDIDO_URL}|ConsultarPedido|${JSON.stringify({ codigo_pedido: Number(codigoPedido) })}`;
  const caches = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
  const cache = caches?.[0];
  // Respeita o expira_em do cooldown (pode ser 10min para erro, 60min para "aguardando")
  return !!(cache?.expira_em && new Date(cache.expira_em).getTime() > Date.now());
}

// Verifica se o pedido deve gerar boleto auto (tipo=venda + cliente BOLETO BANCARIO)
async function deveGerarBoletoAuto(base44, codigoPedido) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({
      omie_codigo_pedido: String(codigoPedido)
    });
    const pedido = pedidos?.[0];
    if (!pedido?.cliente_id) return false;
    const tipo = String(pedido.tipo || 'venda').toLowerCase();
    if (tipo !== 'venda') return false;
    const cliente = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id);
    if (!cliente?.modalidade_pagamento_id) return false;
    const modalidade = await base44.asServiceRole.entities.ModalidadePagamento.get(cliente.modalidade_pagamento_id);
    return String(modalidade?.nome || '').toUpperCase().includes('BOLETO');
  } catch {
    return false;
  }
}

// Cancela pedido local com o motivo SEFAZ
async function cancelarPedidoLocal(base44, codigoPedido, motivo, user) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({
      omie_codigo_pedido: String(codigoPedido)
    });
    const p = pedidos?.[0];
    if (!p) return false;
    await base44.asServiceRole.entities.Pedido.update(p.id, {
      status: 'cancelado',
      motivo_cancelamento: motivo,
      cancelado_por: user.email,
      cancelado_por_nome: user.full_name || '',
      data_cancelamento: new Date().toISOString()
    });
    return true;
  } catch (e) {
    console.error('[atualizarStatusLogsPendentes] falha cancelar pedido local:', e.message);
    return false;
  }
}

// Atualiza o espelho PedidoLiberadoOmie para refletir o status real
async function atualizarEspelho(base44, codigoPedido, resultado) {
  try {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
      { codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1);
    const esp = espelhos?.[0];
    if (!esp) return;
    await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
      etapa: resultado.etapa || esp.etapa,
      status_real: resultado.status_real,
      status_label: resultado.mensagem,
      numero_nf: resultado.numero_nf || esp.numero_nf || '',
      sincronizado_em: new Date().toISOString(),
      origem_sync: 'reconciliacao'
    });
  } catch (e) {
    console.error('[atualizarStatusLogsPendentes] falha atualizar espelho:', e.message);
  }
}

// CORREÇÃO: Atualiza Pedido local (status_faturamento, numero_nota_fiscal) quando NF é confirmada
async function atualizarPedidoLocal(base44, codigoPedido, resultado) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter(
      { omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1);
    const p = pedidos?.[0];
    if (!p) return;
    const updates = {};
    if (resultado.status_real === 'emitida') {
      updates.status = 'faturado';
      updates.status_faturamento = 'faturado';
      updates.faturado = true;
      if (!p.data_faturamento) updates.data_faturamento = new Date().toISOString();
      if (resultado.numero_nf) updates.numero_nota_fiscal = resultado.numero_nf;
    }
    if (Object.keys(updates).length > 0) {
      await base44.asServiceRole.entities.Pedido.update(p.id, updates);
      console.log(`[atualizarStatusLogsPendentes] Pedido ${p.numero_pedido || codigoPedido} atualizado: status_faturamento=faturado${resultado.numero_nf ? ', NF=' + resultado.numero_nf : ''}`);
    }
  } catch (e) {
    console.error('[atualizarStatusLogsPendentes] falha atualizar pedido local:', e.message);
  }
}

// (omieClient inline já definido no início do arquivo)

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Permite execução sem usuário autenticado quando chamada por automation (scheduled).
    // Para chamadas vindas do frontend, exige usuário; para automation, segue como 'sistema'.
    let user = null;
    try { user = await base44.auth.me(); } catch { user = null; }

    const body = await req.json().catch(() => ({}));
    const isSchedule = !!body?.scheduled || !!body?.automation;
    if (!user && !isSchedule) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user) user = { email: 'sistema@automation', full_name: 'Automação Agendada' };

    // Circuit breaker: se bloqueado, aborta imediatamente
    const breaker = await checkCircuitBreaker(base44);
    if (breaker.blocked) {
      return Response.json({ sucesso: false, abortado: true, motivo: 'circuit_breaker', bloqueado_ate: breaker.blockedUntil });
    }

    // 🔒 LOCK: impede execuções simultâneas (2 cliques rápidos = 2x chamadas = rate limit)
    const LOCK_KEY = 'lock_atualizarStatusLogsPendentes';
    const LOCK_TTL_MS = 200_000; // ~3,3 minutos máximo de lock (lote de até 10 pedidos com delay de 8s)
    const lockExistente = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave: LOCK_KEY }, '-created_date', 1).catch(() => []);
    const lockAtivo = lockExistente?.[0];
    if (lockAtivo?.criado_em && (Date.now() - new Date(lockAtivo.criado_em).getTime()) < LOCK_TTL_MS) {
      return Response.json({ sucesso: false, abortado: true, motivo: 'execucao_em_andamento', mensagem: 'Outra execução ainda está em andamento. Aguarde.' });
    }
    // Criar/atualizar lock
    if (lockAtivo?.id) {
      await base44.asServiceRole.entities.CacheOmieConsulta.update(lockAtivo.id, { criado_em: new Date().toISOString(), valor: { status: 'executando' } }).catch(() => {});
    } else {
      await base44.asServiceRole.entities.CacheOmieConsulta.create({ chave: LOCK_KEY, tipo: 'lock', criado_em: new Date().toISOString(), valor: { status: 'executando' }, expira_em: new Date(Date.now() + LOCK_TTL_MS).toISOString() }).catch(() => {});
    }
    // Função para liberar lock no final
    const liberarLock = async () => {
      const l = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave: LOCK_KEY }, '-created_date', 1).catch(() => []);
      if (l?.[0]?.id) await base44.asServiceRole.entities.CacheOmieConsulta.update(l[0].id, { criado_em: new Date(0).toISOString(), valor: { status: 'livre' } }).catch(() => {});
    };

    const { codigos_pedido, status_filtros, mock_omie_response } = body;
    // Quando o usuário passa códigos explícitos (botão "Atualizar"), força a reconsulta
    // ignorando o cooldown de 10min — ele quer destravar AGORA.
    const forcarReconsulta = Array.isArray(codigos_pedido) && codigos_pedido.length > 0;
    const limite24h = Date.now() - 24 * 60 * 60 * 1000;
    // 6 pedidos × (até ~14s cada: ConsultarPedido + delay 6s + ConsultarNF na etapa 60 + delay 8s entre pedidos)
    // mantém o total bem abaixo do teto de 180s da plataforma. Com a automação a cada 15min = 24 pedidos/hora.
    const LIMITE_LOGS = 6;
    const DELAY_ENTRE_CONSULTAS_MS = 8000;

    // Status que serão reconsultados no Omie. Default: apenas 'pendente'.
    // O botão "Atualizar" da tela passa ['pendente','erro'] para reconsultar também os erros recentes.
    const statusReconsultar = Array.isArray(status_filtros) && status_filtros.length > 0
      ? status_filtros
      : ['pendente'];

    // 1) Carrega logs (filtrados por código ou por status)
    let logs = [];
    if (Array.isArray(codigos_pedido) && codigos_pedido.length > 0) {
      // Reconsulta APENAS os códigos passados — independente do status atual.
      // (O frontend já filtrou quais devem ser reconsultados.)
      for (const cod of codigos_pedido) {
        const l = await base44.asServiceRole.entities.LogEmissaoNF.filter({
          codigo_pedido: String(cod)
        }, '-created_date', 5);
        logs.push(...l.filter(item => new Date(item.created_date || item.updated_date || 0).getTime() >= limite24h));
      }
    } else {
      // Sem códigos específicos: busca todos os pendentes em páginas até esgotar
      for (const st of statusReconsultar) {
        let skip = 0;
        const pageSize = 200;
        while (true) {
          const lote = await base44.asServiceRole.entities.LogEmissaoNF.filter({ status: st }, '-created_date', pageSize, skip);
          const arr = Array.isArray(lote) ? lote : [];
          logs.push(...arr.filter(item => new Date(item.created_date || item.updated_date || 0).getTime() >= limite24h));
          if (arr.length < pageSize) break;
          skip += pageSize;
        }
      }
    }

    if (logs.length === 0) {
      await liberarLock();
      return Response.json({ sucesso: true, processados: 0, autorizados: 0, rejeitados: 0, ainda_pendentes: 0, resultados: [], otimizado: true, motivo: 'sem_logs_pendentes_24h' });
    }

    // Debounce aumentado de 5min→15min para reduzir carga na API Omie
    const ultimosProcessamentos = await base44.asServiceRole.entities.LogIntegracaoOmie.filter({ operacao: 'atualizar_log_pendente' }, '-created_date', 1).catch(() => []);
    const ultimo = ultimosProcessamentos?.[0];
    if (!Array.isArray(codigos_pedido) && ultimo && Date.now() - new Date(ultimo.created_date || ultimo.updated_date || 0).getTime() < 5 * 60 * 1000) {
      await liberarLock();
      return Response.json({ sucesso: true, processados: 0, autorizados: 0, rejeitados: 0, ainda_pendentes: logs.length, resultados: [], otimizado: true, motivo: 'debounce_5min' });
    }

    // 🐛 FIX 5: Deduplicar logs por codigo_pedido ANTES de iterar.
    // Sem isso, 10 logs do mesmo pedido = 10 chamadas ConsultarPedido = rate limit.
    // Agora: 1 consulta por pedido, resultado aplicado a todos os logs daquele pedido.
    const logsPorPedido = new Map();
    for (const log of logs) {
      const cod = String(log.codigo_pedido);
      if (!logsPorPedido.has(cod)) logsPorPedido.set(cod, []);
      logsPorPedido.get(cod).push(log);
    }
    // Limitar a LIMITE_LOGS pedidos ÚNICOS (não logs)
    const codigosUnicos = [...logsPorPedido.keys()].slice(0, LIMITE_LOGS);
    // Reconstruct logs list preserving all logs but limited to unique pedidos
    logs = [];
    for (const cod of codigosUnicos) {
      logs.push(...logsPorPedido.get(cod));
    }
    console.log(`[atualizarStatusLogsPendentes] Processando ${logs.length} logs de ${codigosUnicos.length} pedidos únicos (limite ${LIMITE_LOGS} pedidos)`);

    const resultados = [];
    const codigosConsultadosNestaExecucao = new Set();
    const codigosParaBoleto = [];

    const MAX_IDADE_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias
    const MAX_TENTATIVAS = 5;
    const agora = Date.now();

    // Marca todos os logs de um pedido com status 'erro' + mensagem (encerra reprocessamento)
    const encerrarLogs = async (logsDoPedido, mensagem) => {
      for (const l of logsDoPedido) {
        await base44.asServiceRole.entities.LogEmissaoNF.update(l.id, { status: 'erro', mensagem }).catch(() => {});
      }
    };

    // 3) Consulta cada PEDIDO ÚNICO sequencialmente com delay obrigatório entre chamadas
    let chamadaIndex = 0;
    for (const codPed of codigosUnicos) {
      const t0 = Date.now();
      const logsDoPedidoGuard = logsPorPedido.get(codPed) || [];
      try {
        // GUARD 1: codigo_pedido inválido (vazio, 0, não-numérico) → NÃO chamar Omie
        const codNum = Number(codPed);
        if (!codPed || !Number.isFinite(codNum) || codNum <= 0) {
          await encerrarLogs(logsDoPedidoGuard, 'codigo_pedido inválido/ausente — não reprocessar');
          resultados.push({ codigo_pedido: codPed, sucesso: false, novo_status: 'erro', mensagem: 'codigo_pedido inválido/ausente — não reprocessar' });
          continue;
        }

        // GUARD 2a: log pendente há mais de 3 dias → encerrar
        const maisAntigo = logsDoPedidoGuard.reduce((min, l) => {
          const t = new Date(l.created_date || l.updated_date || agora).getTime();
          return t < min ? t : min;
        }, agora);
        if (agora - maisAntigo > MAX_IDADE_MS) {
          await encerrarLogs(logsDoPedidoGuard, 'expirado após 3 dias sem faturamento — não reprocessar');
          resultados.push({ codigo_pedido: codPed, sucesso: false, novo_status: 'erro', mensagem: 'expirado após 3 dias sem faturamento — não reprocessar' });
          continue;
        }

        // GUARD 2b: limite de tentativas atingido → encerrar
        const tentativasMax = logsDoPedidoGuard.reduce((max, l) => Math.max(max, Number(l.tentativas_reconsulta || 0)), 0);
        if (tentativasMax >= MAX_TENTATIVAS) {
          await encerrarLogs(logsDoPedidoGuard, 'limite de tentativas atingido — não reprocessar');
          resultados.push({ codigo_pedido: codPed, sucesso: false, novo_status: 'erro', mensagem: 'limite de tentativas atingido — não reprocessar' });
          continue;
        }

        // Incrementa o contador de tentativas ANTES de consultar (conta esta rodada)
        for (const l of logsDoPedidoGuard) {
          await base44.asServiceRole.entities.LogEmissaoNF.update(l.id, { tentativas_reconsulta: Number(l.tentativas_reconsulta || 0) + 1 }).catch(() => {});
        }

        if (codigosConsultadosNestaExecucao.has(codPed)) {
          console.log(`[atualizarStatusLogsPendentes] Pedido ${codPed} ignorado - consultado há menos de 10 minutos`);
          resultados.push({ codigo_pedido: codPed, sucesso: false, ignorado_cooldown: true, mensagem: 'Consultado há menos de 10 minutos' });
          continue;
        }
        if (!forcarReconsulta && await consultadoRecentemente(base44, codPed)) {
          console.log(`[atualizarStatusLogsPendentes] Pedido ${codPed} ignorado - consultado há menos de 10 minutos`);
          resultados.push({ codigo_pedido: codPed, sucesso: false, ignorado_cooldown: true, mensagem: 'Consultado há menos de 10 minutos' });
          continue;
        }
        codigosConsultadosNestaExecucao.add(codPed);

        // Re-verificar circuit breaker antes de cada consulta (outra função pode ter ativado)
        const breakerMid = await checkCircuitBreaker(base44);
        if (breakerMid.blocked) {
          console.warn(`[atualizarStatusLogsPendentes] Circuit breaker ativado durante execução — abortando restante`);
          resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, mensagem: `API bloqueada até ${breakerMid.blockedUntil}`, abortado: true });
          break;
        }

        const real = await consultarStatusReal(base44, codPed, mock_omie_response);
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: 'produtos/pedido',
          call: 'ConsultarPedido',
          operacao: 'atualizar_log_pendente',
          status: real.erro ? 'erro' : 'sucesso',
          duracao_ms: Date.now() - t0,
          mensagem_erro: real.erro || null,
          payload_enviado: JSON.stringify({ codigo_pedido: codPed }),
          payload_resposta: JSON.stringify(real).slice(0, 800),
          usuario_email: user.email
        }).catch(() => {});

        const logsDoPedido = logsPorPedido.get(codPed) || [];

        if (real.erro) {
          await registrarCooldownConsulta(base44, codPed, { erro: real.erro });
          for (const l of logsDoPedido) {
            await base44.asServiceRole.entities.LogEmissaoNF.update(l.id, { status: 'erro', mensagem: real.erro });
          }
          resultados.push({ codigo_pedido: codPed, sucesso: false, novo_status: 'erro', mensagem: real.erro });
          continue;
        }

        if (real.status_real === 'aguardando') {
          // 🛡️ FIX CRÍTICO: registrar cooldown LONGO (60min) para pedidos "aguardando".
          // Sem isso, os MESMOS pedidos travados na etapa 60 sem NF eram reconsultados
          // a cada execução (30min) eternamente — causa raiz dos bloqueios por consumo indevido.
          await registrarCooldownConsulta(base44, codPed, { aguardando: true, mensagem: real.mensagem }, 240);
          resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, mensagem: real.mensagem });
          continue;
        }

        // ✅ Tem resposta final — atualiza espelho + pedido local + logs
        await atualizarEspelho(base44, codPed, real);
        if (real.status_real === 'emitida') {
          await atualizarPedidoLocal(base44, codPed, real);
        }
        let novoStatus;
        if (real.status_real === 'emitida') novoStatus = 'autorizada';
        else if (real.status_real === 'rejeitada' || real.status_real === 'cancelada' || real.status_real === 'denegada') novoStatus = 'rejeitada';
        else novoStatus = 'pendente';

        let deveBoleto = false;
        if (novoStatus === 'autorizada') {
          deveBoleto = await deveGerarBoletoAuto(base44, codPed);
          if (deveBoleto) codigosParaBoleto.push(codPed);
        }

        let primeiroLog = true;
        for (const l of logsDoPedido) {
          await base44.asServiceRole.entities.LogEmissaoNF.update(l.id, {
            status: novoStatus,
            numero_nf: real.numero_nf || l.numero_nf || '',
            mensagem: real.mensagem,
            codigo_sefaz: real.codigo_sefaz || (novoStatus === 'autorizada' ? '100' : ''),
            boleto_gerado: (primeiroLog && deveBoleto) ? true : (l.boleto_gerado || false)
          });
          primeiroLog = false;
        }

        // Cancela pedido local apenas em casos definitivos: NF denegada ou NF realmente cancelada.
        // Rejeição comum volta para etapa 50 e deve continuar disponível para correção/reemissão.
        if (real.status_real === 'denegada' || real.status_real === 'cancelada') {
          await cancelarPedidoLocal(base44, codPed, real.mensagem, user);
        }

        resultados.push({
          codigo_pedido: codPed,
          sucesso: true,
          novo_status: novoStatus,
          numero_nf: real.numero_nf || '',
          codigo_sefaz: real.codigo_sefaz || '',
          mensagem: real.mensagem,
          boleto_disparado: deveBoleto
        });
      } catch (e) {
        // Suspensão ou bloqueio → PARAR IMEDIATAMENTE, não consultar mais nada
        if (e.suspensao || e.bloqueio) {
          console.error(`[atualizarStatusLogsPendentes] API Omie ${e.suspensao ? 'SUSPENSA' : 'BLOQUEADA'} — abortando restante do lote. Erro: ${e.message}`);
          resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, mensagem: e.message, abortado: true });
          break;
        }
        resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, mensagem: e.message });
      }

      // Delay obrigatório entre consultas (não no último)
      chamadaIndex++;
      if (chamadaIndex < codigosUnicos.length) {
        await new Promise(r => setTimeout(r, DELAY_ENTRE_CONSULTAS_MS));
      }
    }

    // 4) Dispara boletos automáticos para autorizadas (cliente BOLETO + tipo=venda)
    if (codigosParaBoleto.length > 0) {
      try {
        await new Promise(r => setTimeout(r, 3000));
        await base44.asServiceRole.functions.invoke('gerarBoletosOmie', {
          origem: 'auto',
          pedidos: codigosParaBoleto.map(codigo_pedido => ({ codigo_pedido }))
        });
      } catch (e) {
        console.error('[atualizarStatusLogsPendentes] erro gerar boletos:', e.message);
      }
    }

    const autorizados = resultados.filter(r => r.novo_status === 'autorizada').length;
    const rejeitados = resultados.filter(r => r.novo_status === 'rejeitada').length;
    const aindaPendentes = resultados.filter(r => r.ainda_pendente).length;


    await liberarLock();
    return Response.json({
      sucesso: true,
      processados: resultados.filter(r => !r.ignorado_cooldown).length,
      ignorados_cooldown: resultados.filter(r => r.ignorado_cooldown).length,
      autorizados,
      rejeitados,
      ainda_pendentes: aindaPendentes,
      boletos_disparados: codigosParaBoleto.length,
      resultados
    });
  } catch (error) {
    // Liberar lock em caso de erro
    try {
      const base44Err = createClientFromRequest(req);
      const l = await base44Err.asServiceRole.entities.CacheOmieConsulta.filter({ chave: 'lock_atualizarStatusLogsPendentes' }, '-created_date', 1).catch(() => []);
      if (l?.[0]?.id) await base44Err.asServiceRole.entities.CacheOmieConsulta.update(l[0].id, { criado_em: new Date(0).toISOString(), valor: { status: 'livre' } }).catch(() => {});
    } catch {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});