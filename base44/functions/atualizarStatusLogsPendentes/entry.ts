import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.omie_app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.omie_app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
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
          const until = new Date(Date.now() + 30 * 60000).toISOString();
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: 'principal', bloqueado: true, bloqueado_ate: until, ultimo_erro: data.faultstring, atualizado_em: new Date().toISOString() }).catch(() => null);
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

// ✅ ITEM 7
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

// Credenciais resolvidas dentro do handler (não no nível do módulo) para usar ConfiguracaoOmie do banco.
// Fallback para env vars caso não haja config ativa.
let _creds = null;

function formatarDataBrasilia(isoDate) {
  return new Date(isoDate).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}


// Classifica o status de uma NF com base no cStat da SEFAZ
function classificarNF(nf, codigoPedido) {
  const cStat = String(nf?.ide?.cStat || '').trim();
  const nNF = String(nf?.ide?.nNF || '').trim();
  const xMotivo = String(nf?.ide?.xMotivo || '').trim();
  if (!cStat && !nNF) return null; // Sem dados suficientes para classificar

  const cStatNum = Number(cStat) || 0;

  // 100 = Autorizada
  if (cStat === '100' || cStat === '150') {
    return { status_real: 'emitida', numero_nf: nNF, codigo_sefaz: cStat, mensagem: nNF ? `NF ${nNF} autorizada` : 'NF autorizada pela SEFAZ' };
  }
  // 101 = Cancelamento homologado
  if (cStat === '101') {
    return { status_real: 'cancelada', numero_nf: nNF, codigo_sefaz: cStat, mensagem: `NF ${nNF || codigoPedido} cancelada [SEFAZ ${cStat}]` };
  }
  // 110, 301, 302, 205 = Denegada
  if (['110', '301', '302', '205'].includes(cStat)) {
    return { status_real: 'denegada', numero_nf: nNF, codigo_sefaz: cStat, mensagem: `NF denegada [SEFAZ ${cStat}] ${xMotivo}`.trim() };
  }
  // 135 = Evento registrado (não é rejeição)
  if (cStat === '135') return null;
  // cStat >= 200 e não é um dos acima = Rejeitada
  if (cStatNum >= 200) {
    return { status_real: 'rejeitada', numero_nf: nNF, codigo_sefaz: cStat, mensagem: `NF rejeitada [SEFAZ ${cStat}] ${xMotivo}`.trim() };
  }
  // Se tem nNF mas sem cStat definitivo → provavelmente autorizada
  if (nNF) {
    return { status_real: 'emitida', numero_nf: nNF, codigo_sefaz: cStat || '100', mensagem: `NF ${nNF} autorizada` };
  }
  return null;
}

async function consultarStatusReal(base44, codigoPedido, mockOmieResponse = null) {
  let pedido;
  try {
    if (mockOmieResponse) {
      console.log(`[atualizarStatusLogsPendentes] MOCK Omie usado para pedido ${codigoPedido}; nenhuma chamada real realizada`);
      pedido = mockOmieResponse?.pedido_venda_produto || mockOmieResponse || {};
    } else {
      const r = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigoPedido) }, { call: 'ConsultarPedido' });
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
  const cStatConsulta = infoNfe.cStat || infoNfe.cStatus || '';
  const nf = {
    ide: {
      cStat: cStatConsulta,
      nNF,
      xMotivo: infoNfe.xMotivo || infoNfe.cMensStatus || infoNfe.motivo || ''
    }
  };
  const classificada = classificarNF(nf, codigoPedido);
  if (classificada) return { etapa, ...classificada };

  // Etapa 60 sem cStat no ConsultarPedido → buscar NF real via nfconsultar para obter cStat da SEFAZ
  if (etapa === '60') {
    try {
      const nfData = await omieCall(base44, 'produtos/nfconsultar/', {
        nPagina: 1, nRegPorPagina: 5,
        cDetalhar: 'S',
        lApenasResumo: 'N',
        tpNF: '1',
        nfeFiltro: { nCodPed: Number(codigoPedido) }
      }, { call: 'ListarNF', skipLog: true });
      const nfs = nfData?.nfCadastro || [];
      // Procurar a NF mais recente deste pedido
      for (const nfItem of nfs) {
        const ide = nfItem?.ide || {};
        const cStatNf = String(ide.cStat || '').trim();
        const nNfReal = String(ide.nNF || '').trim();
        if (!cStatNf && !nNfReal) continue;
        const classificadaNf = classificarNF({ ide }, codigoPedido);
        if (classificadaNf) {
          console.log(`[atualizarStatusLogsPendentes] Pedido ${codigoPedido} etapa 60: NF ${nNfReal} cStat=${cStatNf} → ${classificadaNf.status_real}`);
          return { etapa, ...classificadaNf };
        }
      }
      // Se ListarNF retornou resultados mas sem cStat definido → aguardando processamento SEFAZ
      if (nfs.length > 0) {
        const nfNuResumo = String(nfs[0]?.ide?.nNF || '').trim();
        return { etapa, status_real: 'aguardando_nf', numero_nf: nfNuResumo, mensagem: `NF ${nfNuResumo || '?'} em processamento na SEFAZ (sem cStat definido)` };
      }
    } catch (e) {
      console.warn(`[atualizarStatusLogsPendentes] Falha ao consultar NF do pedido ${codigoPedido}: ${e.message}`);
    }
    // Sem NF encontrada na consulta → aguardando emissão
    return { etapa, status_real: 'aguardando_nf', numero_nf: nNF || '', mensagem: nNF ? `Pedido etapa 60 com NF ${nNF} — aguardando confirmação SEFAZ` : 'Pedido etapa 60 — aguardando NF da SEFAZ' };
  }
  return { etapa, status_real: 'aguardando', mensagem: `Pedido em etapa ${etapa || '?'} — ainda processando` };
}

async function registrarCooldownConsulta(base44, codigoPedido, valor = {}) {
  const chave = `${OMIE_PEDIDO_URL}|ConsultarPedido|${JSON.stringify({ codigo_pedido: Number(codigoPedido) })}`;
  const payloadCache = {
    chave,
    valor,
    tipo: `ConsultarPedido:${codigoPedido}`,
    expira_em: new Date(Date.now() + 10 * 60000).toISOString(),
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
  return !!(cache?.criado_em && Date.now() - new Date(cache.criado_em).getTime() < 5 * 60 * 1000);
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
      { codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1
    );
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
      { omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1
    );
    const p = pedidos?.[0];
    if (!p) return;
    const updates = {};
    if (resultado.status_real === 'emitida') {
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

    const { codigos_pedido, status_filtros, mock_omie_response } = body;
    const limite24h = Date.now() - 24 * 60 * 60 * 1000;
    const LIMITE_LOGS = 10; // Aumentado para resolver mais pendentes por execução
    const DELAY_ENTRE_CONSULTAS_MS = 3000; // 3s entre cada ConsultarPedido

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
      return Response.json({ sucesso: true, processados: 0, autorizados: 0, rejeitados: 0, ainda_pendentes: 0, resultados: [], otimizado: true, motivo: 'sem_logs_pendentes_24h' });
    }

    // Debounce aumentado de 5min→15min para reduzir carga na API Omie
    const ultimosProcessamentos = await base44.asServiceRole.entities.LogIntegracaoOmie.filter({ operacao: 'atualizar_log_pendente' }, '-created_date', 1).catch(() => []);
    const ultimo = ultimosProcessamentos?.[0];
    if (!Array.isArray(codigos_pedido) && ultimo && Date.now() - new Date(ultimo.created_date || ultimo.updated_date || 0).getTime() < 5 * 60 * 1000) {
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

    // 3) Consulta cada PEDIDO ÚNICO sequencialmente com delay obrigatório entre chamadas
    let chamadaIndex = 0;
    for (const codPed of codigosUnicos) {
      const t0 = Date.now();
      try {
        if (codigosConsultadosNestaExecucao.has(codPed)) {
          console.log(`[atualizarStatusLogsPendentes] Pedido ${codPed} ignorado - consultado há menos de 10 minutos`);
          resultados.push({ codigo_pedido: codPed, sucesso: false, ignorado_cooldown: true, mensagem: 'Consultado há menos de 10 minutos' });
          continue;
        }
        if (await consultadoRecentemente(base44, codPed)) {
          console.log(`[atualizarStatusLogsPendentes] Pedido ${codPed} ignorado - consultado há menos de 10 minutos`);
          resultados.push({ codigo_pedido: codPed, sucesso: false, ignorado_cooldown: true, mensagem: 'Consultado há menos de 10 minutos' });
          continue;
        }
        codigosConsultadosNestaExecucao.add(codPed);

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
    return Response.json({ error: error.message }, { status: 500 });
  }
});