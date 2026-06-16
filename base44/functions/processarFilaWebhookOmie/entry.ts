import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ⚙️ PROCESSADOR SEQUENCIAL DA FILA DE WEBHOOKS OMIE
// ─────────────────────────────────────────────────────────────────────────────
// PROBLEMA RAIZ que isto resolve:
//   A entity automation antiga disparava processarWebhookOmie em PARALELO para
//   cada LogIntegracaoOmie criado. Numa rajada de faturamento (20-30 webhooks em
//   segundos), isso virava 20-30 chamadas SIMULTÂNEAS à API Omie → "consumo
//   indevido" (rate limit) → circuit breaker aberto repetidamente.
//
// SOLUÇÃO:
//   Esta função roda AGENDADA (a cada 5 min) e processa os webhooks pendentes
//   UM POR VEZ, sequencialmente, com delay entre chamadas. Respeita o circuit
//   breaker ANTES de cada item (se bloqueado, para e deixa pra próxima rodada,
//   sem acumular erro). Deduplica por messageId e por codIntPedido+etapa.
//
// Padrões do projeto: base44 1º arg, SDK 0.8.31, sequencial + delay + retry,
// filter por chave (nunca list), função auto-contida (omieCall inline).

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID_WEBHOOK = '6a1e06a9aa62ceab7b3b6d97';

// Quantos webhooks processar por execução. A função tem timeout de ~180s, então
// usamos TEMPO_MAX_MS=150s como teto e paramos antes — o resto fica para o próximo
// ciclo (5 min). Com ~2,5s/item, cabem ~55 itens/ciclo = ~660/h (> taxa de pico).
const MAX_POR_RODADA = 60;
// Teto de tempo de parede por execução — bem MENOR que o timeout real (~180s) para
// parar com folga e deixar o self-chain/scheduler continuar a fila. Com ~30 itens
// (~75s a 2,5s/item) sob o teto, jamais batemos no timeout do isolate.
const TEMPO_MAX_MS = 80000; // 80s
// Delay entre cada item que efetivamente chama a Omie (espacar as chamadas).
const DELAY_ENTRE_ITENS_MS = 2500;

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
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID_WEBHOOK }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false, record: c };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_WEBHOOK, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false, record: c };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro, record: c };
}

function extrairSegundosBloqueioWH(msg) {
  const match = String(msg).match(/(\d+)\s*segundo/i);
  if (match) return Math.min(Number(match[1]), 1800);
  return 0;
}

async function abrirCircuitBreaker(base44, faultstring) {
  const secs = extrairSegundosBloqueioWH(faultstring);
  const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID_WEBHOOK }, '-created_date', 1).catch(() => []);
  const _cb = _cbRows?.[0];
  const _erros = (_cb?.erros_consecutivos || 0) + 1;
  const _thresh = _cb?.threshold_erros ?? 3;
  const _p = { erros_consecutivos: _erros, ultimo_erro: String(faultstring).slice(0, 500), atualizado_em: new Date().toISOString() };
  if (_erros >= _thresh && secs > 0) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + secs * 1000).toISOString(); }
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_WEBHOOK, _p).catch(() => null);
}

async function omieCall(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) { const e = new Error(`API Omie bloqueada até ${cb.blockedUntil}`); e.code = 'OMIE_BLOQUEADA'; throw e; }
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1500, 3000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          await abrirCircuitBreaker(base44, data.faultstring);
          const err = new Error(data.faultstring); err.code = 'OMIE_BLOQUEADA'; throw err;
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) {
          lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        }
        throw new Error(data.faultstring);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_WEBHOOK, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e) {
      if (e.code === 'OMIE_BLOQUEADA') throw e;
      lastErr = e.name === 'AbortError' ? 'Timeout na chamada Omie' : e.message;
      if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}

// ─── Helpers de status/espelho (reaproveitados de processarWebhookOmie) ───
function mapEtapaParaStatus(etapa) {
  const e = String(etapa || '');
  if (e === '10') return 'pendente';
  if (e === '20') return 'liberado';
  if (e === '50') return 'montagem';
  if (e === '60') return 'faturado';
  if (e === '70' || e === '80') return 'cancelado';
  return null;
}

function recalcularStatusCarga(pedidosOmie, statusAtual) {
  if (!Array.isArray(pedidosOmie) || pedidosOmie.length === 0) return statusAtual || 'montagem';
  const todos = pedidosOmie;
  const todosFaturados = todos.every(p => p.etapa === '60' || p.status_pedido === 'faturado');
  const todosCancelados = todos.every(p => p.etapa === '80' || p.etapa === 'excluido' || p.status_pedido === 'cancelado');
  if (todosFaturados) return 'faturada';
  if (todosCancelados) return 'cancelada';
  if (todos.some(p => p.etapa === '60')) return statusAtual === 'faturada' ? 'faturada' : 'conferindo';
  return statusAtual === 'cancelada' ? 'montagem' : (statusAtual || 'conferindo');
}

const ETAPAS_ESPELHO = new Set(['10', '20', '50', '60']);

function calcularStatusNF(cabecalho, infoNfe) {
  if (infoNfe?.cStatus === 'CANCELADA' || cabecalho?.cancelado === 'S') return { status_real: 'cancelada', status_label: 'NF Cancelada' };
  if (infoNfe?.cStatus === 'DENEGADA') return { status_real: 'denegada', status_label: 'NF Denegada' };
  if (infoNfe?.cStatus === 'REJEITADA') return { status_real: 'rejeitada', status_label: 'NF Rejeitada' };
  if (infoNfe?.cStatus === 'AUTORIZADA' || infoNfe?.nNF) return { status_real: 'emitida', status_label: 'Faturado' };
  return { status_real: 'aguardando_nf', status_label: 'Aguardando NF' };
}

async function removerDoEspelho(base44, omieCodigoPedido) {
  if (!omieCodigoPedido) return;
  const existentes = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) });
  for (const e of existentes) await base44.asServiceRole.entities.PedidoLiberadoOmie.delete(e.id);
}

async function upsertEspelho(base44, omieCodigoPedido, forceNumeroNf = null, forceRejeicao = null) {
  if (!omieCodigoPedido) return;

  if (forceRejeicao) {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) }, '-sincronizado_em', 1);
    const esp = espelhos[0];
    if (esp) {
      await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
        etapa: '60', status_real: forceRejeicao.status_real, status_label: forceRejeicao.status_label,
        sincronizado_em: new Date().toISOString(), origem_sync: 'webhook'
      });
      return;
    }
  }

  if (forceNumeroNf) {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) }, '-sincronizado_em', 1);
    const esp = espelhos[0];
    if (esp) {
      await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
        etapa: '60', status_real: 'emitida', status_label: 'Faturado', numero_nf: String(forceNumeroNf),
        data_faturamento: esp.data_faturamento || new Date().toISOString(),
        sincronizado_em: new Date().toISOString(), origem_sync: 'webhook'
      });
      return;
    }
  }

  // ConsultarPedido respeita o circuit breaker via omieCall (lança OMIE_BLOQUEADA).
  // 105/5113/"não cadastrado" = pedido não existe → TERMINAL (nunca retry, evita erro 6).
  let data;
  try {
    data = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(omieCodigoPedido) }, { call: 'ConsultarPedido' });
  } catch (e) {
    if (e.code === 'OMIE_BLOQUEADA') throw e;
    const m = String(e.message || '').toLowerCase();
    if (m.includes('não cadastrado') || m.includes('nao cadastrado') || m.includes('não existem registros') || m.includes('nao existem registros') || m.includes('105') || m.includes('5113')) return;
    throw e;
  }
  const pedidoBruto = data?.pedido_venda_produto;
  if (!pedidoBruto || !pedidoBruto?.cabecalho) return;
  const etapa = String(pedidoBruto.cabecalho.etapa || '');

  if (!ETAPAS_ESPELHO.has(etapa)) { await removerDoEspelho(base44, omieCodigoPedido); return; }

  const codigoClienteOmie = String(pedidoBruto.cabecalho.codigo_cliente || '');
  const [clientesPorIntegracao, clientesPorInterno, clientesPorOmie, pedidosLocais] = await Promise.all([
    base44.asServiceRole.entities.Cliente.filter({ codigo_integracao: codigoClienteOmie }, '-created_date', 5),
    base44.asServiceRole.entities.Cliente.filter({ codigo_interno: codigoClienteOmie }, '-created_date', 5),
    base44.asServiceRole.entities.Cliente.filter({ codigo_omie: codigoClienteOmie }, '-created_date', 5),
    base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(omieCodigoPedido) })
  ]);
  const cliente = clientesPorIntegracao[0] || clientesPorInterno[0] || clientesPorOmie[0] || null;
  const pedidoLocal = pedidosLocais[0] || null;

  const rotaIdEfetivo = cliente?.rota_id || pedidoLocal?.rota_id || null;
  const vendedorIdEfetivo = cliente?.vendedor_id || pedidoLocal?.vendedor_id || null;
  const [rotaRec, vendedorRec] = await Promise.all([
    rotaIdEfetivo ? base44.asServiceRole.entities.Rota.filter({ id: rotaIdEfetivo }, '-created_date', 1).catch(() => []) : Promise.resolve([]),
    vendedorIdEfetivo ? base44.asServiceRole.entities.Vendedor.filter({ id: vendedorIdEfetivo }, '-created_date', 1).catch(() => []) : Promise.resolve([])
  ]);
  const rotaNome = rotaRec[0]?.nome || pedidoLocal?.rota_nome || '';
  const vendedorNome = vendedorRec[0]?.nome || pedidoLocal?.vendedor_nome || '';

  let tipoOperacao = pedidoLocal?.tipo || null;
  if (!tipoOperacao) {
    const codCenarioOmie = String(pedidoBruto.cabecalho.codigo_cenario || pedidoBruto.cabecalho.codigo_parcela || '');
    if (codCenarioOmie) {
      const cenariosLocais = await base44.asServiceRole.entities.CenarioFiscalLocal.filter({ cenario_omie_codigo: codCenarioOmie }, '-created_date', 1).catch(() => []);
      tipoOperacao = cenariosLocais[0]?.tipo_operacao || null;
    }
  }
  tipoOperacao = tipoOperacao || 'venda';

  const infoNfe = pedidoBruto.infoNfe || pedidoBruto.info_nf || null;
  const numeroNf = String(infoNfe?.nNF || infoNfe?.numero_nf || pedidoBruto.cabecalho?.numero_nfe || '');
  const cStatNfe = String(infoNfe?.cStat || '');
  const xMotivoNfe = infoNfe?.xMotivo || infoNfe?.cMensStatus || '';
  let statusNf;
  if (etapa === '60') {
    statusNf = calcularStatusNF(pedidoBruto.cabecalho, infoNfe);
  } else if (etapa === '50' && cStatNfe && Number(cStatNfe) >= 200 && !['100', '101', '135', '150'].includes(cStatNfe)) {
    statusNf = { status_real: ['110', '301', '302', '205'].includes(cStatNfe) ? 'denegada' : 'rejeitada', status_label: `[SEFAZ ${cStatNfe}] ${xMotivoNfe || 'NF rejeitada'}` };
  } else if (etapa === '50') {
    statusNf = { status_real: 'aguardando_nf', status_label: 'Aguardando processamento SEFAZ' };
  } else {
    statusNf = { status_real: null, status_label: null };
  }

  const registro = {
    codigo_pedido: String(omieCodigoPedido),
    codigo_pedido_integracao: pedidoBruto.cabecalho.codigo_pedido_integracao || '',
    numero_pedido: String(pedidoBruto.cabecalho.numero_pedido || ''),
    etapa, status_real: statusNf.status_real, status_label: statusNf.status_label, numero_nf: numeroNf,
    data_faturamento: etapa === '60' ? (infoNfe?.dEmiNFe || new Date().toISOString()) : null,
    codigo_cliente: codigoClienteOmie,
    codigo_cliente_integracao: cliente?.codigo_integracao || cliente?.codigo || pedidoLocal?.cliente_codigo || '',
    codigo_cliente_cod: String(cliente?.codigo_interno || cliente?.codigo || cliente?.codigo_integracao || pedidoLocal?.cliente_codigo || ''),
    cnpj_cpf_cliente: cliente?.cnpj_cpf || pedidoLocal?.cliente_cpf_cnpj || '',
    cliente_id: cliente?.id || pedidoLocal?.cliente_id || null,
    nome_cliente: cliente?.razao_social || pedidoLocal?.cliente_nome || `Cliente ${codigoClienteOmie}`,
    nome_fantasia: cliente?.nome_fantasia || pedidoLocal?.cliente_nome_fantasia || cliente?.razao_social || '',
    cidade: cliente?.cidade || pedidoLocal?.cliente_cidade || '',
    tipo_nota: cliente?.tipo_nota || pedidoLocal?.modelo_nota || '55',
    tipo_operacao: tipoOperacao, tags_cliente: cliente?.tags || [], motorista_padrao_id: cliente?.motorista_id || null,
    rota_id: cliente?.rota_id || pedidoLocal?.rota_id || null, rota_nome: rotaNome || 'Sem Rota', rota_cliente: rotaNome || 'Sem Rota',
    vendedor_id: cliente?.vendedor_id || pedidoLocal?.vendedor_id || null, vendedor_nome: vendedorNome,
    data_previsao: pedidoBruto.cabecalho.data_previsao || '',
    quantidade_itens: (pedidoBruto.det || []).length,
    valor_total_pedido: pedidoBruto.total_pedido?.valor_total_pedido || 0,
    pedido_id: pedidoLocal?.id || null,
    produtos: (pedidoBruto.det || []).map(d => ({
      codigo_produto: String(d.produto?.codigo_produto || ''), codigo_produto_integracao: d.produto?.codigo_produto_integracao || '',
      descricao: d.produto?.descricao || '', quantidade: d.produto?.quantidade || 0,
      valor_unitario: d.produto?.valor_unitario || 0, valor_total: d.produto?.valor_total || 0, unidade: d.produto?.unidade || ''
    })),
    sincronizado_em: new Date().toISOString(), origem_sync: 'webhook'
  };

  const existentes = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) });
  if (existentes.length > 0) await base44.asServiceRole.entities.PedidoLiberadoOmie.update(existentes[0].id, registro);
  else await base44.asServiceRole.entities.PedidoLiberadoOmie.create(registro);
}

async function atualizarPedidoNaCarga(base44, omieCodigoPedido, dadosAtualizados) {
  if (!omieCodigoPedido) return;
  let cargaAlvo = null;
  const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(omieCodigoPedido) }, '-created_date', 1).catch(() => []);
  const cargaId = pedidosLocais?.[0]?.carga_id;
  if (cargaId) cargaAlvo = await base44.asServiceRole.entities.Carga.get(cargaId).catch(() => null);

  let cargas;
  if (cargaAlvo) {
    cargas = [cargaAlvo];
  } else {
    const [cargasMontagem, cargasFaturadas] = await Promise.all([
      base44.asServiceRole.entities.Carga.filter({ status_carga: 'montagem' }, '-created_date', 500).catch(() => []),
      base44.asServiceRole.entities.Carga.filter({ status_carga: 'faturada' }, '-created_date', 500).catch(() => [])
    ]);
    cargas = [...cargasMontagem, ...cargasFaturadas];
  }

  for (const carga of cargas) {
    const pedidos = Array.isArray(carga.pedidos_omie) ? carga.pedidos_omie : [];
    const idx = pedidos.findIndex(p => String(p.codigo_pedido) === String(omieCodigoPedido));
    if (idx === -1) continue;
    const pedidoAtual = pedidos[idx];
    const nfAtual = String(pedidoAtual.numero_nf || '').trim();
    const nfNova = String(dadosAtualizados.numero_nf || '').trim();
    const dadosSeguros = { ...dadosAtualizados };
    if ('numero_nf' in dadosAtualizados && !nfNova) delete dadosSeguros.numero_nf;
    const novosPedidos = pedidos.map((p, i) => i === idx ? { ...p, ...dadosSeguros } : p);
    const novoStatus = recalcularStatusCarga(novosPedidos, carga.status_carga);
    const updates = { pedidos_omie: novosPedidos };
    if (novoStatus !== carga.status_carga) updates.status_carga = novoStatus;
    if (novoStatus === 'faturada' && !carga.data_faturamento) updates.data_faturamento = new Date().toISOString();
    await base44.asServiceRole.entities.Carga.update(carga.id, updates);
    return;
  }
}

// === HANDLERS POR DOMÍNIO (mesma lógica de processarWebhookOmie) ===

async function handlePedido(base44, topic, evt) {
  const codigoPedido = String(evt?.idPedido || evt?.id_pedido || evt?.codigo_pedido || evt?.nCodPed || '');
  if (!codigoPedido) return { acao: 'ignorado', motivo: 'sem codigo_pedido' };

  let espelhoAcao = null;
  if (topic === 'VendaProduto.Excluida' || topic === 'VendaProduto.Devolvida') {
    await removerDoEspelho(base44, codigoPedido); espelhoAcao = 'removido';
  } else if (topic === 'VendaProduto.Cancelada') {
    espelhoAcao = 'cancelada_verificar_nf';
  } else if (topic === 'VendaProduto.Faturada') {
    // Não chama Omie — atualiza espelho com dados do evento.
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1);
    if (espelhos?.[0]) {
      await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
        etapa: '60', status_real: 'aguardando_nf', status_label: 'Aguardando NF',
        numero_nf: evt?.numero_nf ? String(evt.numero_nf) : (espelhos[0].numero_nf || ''),
        sincronizado_em: new Date().toISOString(), origem_sync: 'webhook'
      });
    } else {
      const pl = (await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1).catch(() => []))[0] || null;
      await base44.asServiceRole.entities.PedidoLiberadoOmie.create({
        codigo_pedido: String(codigoPedido), numero_pedido: pl?.numero_pedido || evt?.numero_pedido || '',
        etapa: '60', status_real: 'aguardando_nf', status_label: 'Aguardando NF',
        numero_nf: evt?.numero_nf ? String(evt.numero_nf) : '', cliente_id: pl?.cliente_id || null,
        nome_cliente: pl?.cliente_nome || '', nome_fantasia: pl?.cliente_nome_fantasia || '', cidade: pl?.cliente_cidade || '',
        rota_id: pl?.rota_id || null, rota_nome: pl?.rota_nome || '', vendedor_id: pl?.vendedor_id || null,
        vendedor_nome: pl?.vendedor_nome || '', valor_total_pedido: pl?.valor_total || 0, pedido_id: pl?.id || null,
        sincronizado_em: new Date().toISOString(), origem_sync: 'webhook'
      });
    }
    espelhoAcao = 'upsert_local';
  } else if (topic === 'VendaProduto.Incluida') {
    const jaExisteLocal = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1).catch(() => []);
    if (jaExisteLocal.length > 0) {
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1);
      if (!espelhos.length) {
        const pl = jaExisteLocal[0];
        await base44.asServiceRole.entities.PedidoLiberadoOmie.create({
          codigo_pedido: String(codigoPedido), numero_pedido: pl.numero_pedido || '', etapa: evt?.etapa || '10',
          cliente_id: pl.cliente_id || null, nome_cliente: pl.cliente_nome || '', nome_fantasia: pl.cliente_nome_fantasia || '',
          cidade: pl.cliente_cidade || '', rota_id: pl.rota_id || null, rota_nome: pl.rota_nome || '',
          vendedor_id: pl.vendedor_id || null, vendedor_nome: pl.vendedor_nome || '', valor_total_pedido: pl.valor_total || 0,
          pedido_id: pl.id, sincronizado_em: new Date().toISOString(), origem_sync: 'webhook'
        });
      }
      espelhoAcao = 'upsert_local_skip_omie';
    } else {
      await upsertEspelho(base44, codigoPedido); espelhoAcao = 'upsert';
    }
  } else if (topic === 'VendaProduto.EtapaAlterada' || topic === 'VendaProduto.Alterada') {
    const etapaEvtEspelho = String(evt?.etapa || '');
    if (etapaEvtEspelho === '10' || etapaEvtEspelho === '20') {
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1);
      const novoStatusEspelho = etapaEvtEspelho === '20' ? 'Pedido Liberado' : 'Pedido Pendente';
      if (espelhos?.[0]) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, { etapa: etapaEvtEspelho, status_label: novoStatusEspelho, sincronizado_em: new Date().toISOString(), origem_sync: 'webhook' });
      } else {
        const pl = (await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1).catch(() => []))[0];
        if (pl) {
          await base44.asServiceRole.entities.PedidoLiberadoOmie.create({
            codigo_pedido: String(codigoPedido), numero_pedido: pl.numero_pedido || String(evt?.numeroPedido || ''), etapa: etapaEvtEspelho,
            status_label: novoStatusEspelho, cliente_id: pl.cliente_id || null, nome_cliente: pl.cliente_nome || '',
            nome_fantasia: pl.cliente_nome_fantasia || '', cidade: pl.cliente_cidade || '', rota_id: pl.rota_id || null,
            rota_nome: pl.rota_nome || '', vendedor_id: pl.vendedor_id || null, vendedor_nome: pl.vendedor_nome || '',
            valor_total_pedido: pl.valor_total || 0, pedido_id: pl.id, sincronizado_em: new Date().toISOString(), origem_sync: 'webhook'
          });
        }
      }
      espelhoAcao = 'upsert_local_etapa';
    } else {
      await upsertEspelho(base44, codigoPedido); espelhoAcao = 'upsert';
    }
  }

  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
  if (pedidos.length === 0) return { acao: 'ignorado', motivo: 'pedido não encontrado no Base44', espelho: espelhoAcao };

  const pedido = pedidos[0];
  const updates = {};
  const dadosCarga = {};

  if (topic === 'VendaProduto.Faturada') {
    updates.status = 'faturado'; updates.faturado = true; updates.status_faturamento = 'faturado'; updates.data_faturamento = new Date().toISOString();
    if (evt?.numero_nf) { updates.numero_nota_fiscal = String(evt.numero_nf); dadosCarga.numero_nf = String(evt.numero_nf); }
    dadosCarga.etapa = '60'; dadosCarga.status_pedido = 'faturado';
    const logsPendentes = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: codigoPedido, status: 'pendente' }, '-created_date', 5).catch(() => []);
    for (const log of logsPendentes) {
      await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, { status: 'autorizada', numero_nf: evt?.numero_nf ? String(evt.numero_nf) : log.numero_nf || '', codigo_sefaz: '100', mensagem: 'NF emitida (etapa 60 confirmada no Omie)', boleto_gerado: false }).catch(() => {});
    }
  } else if (topic === 'VendaProduto.Excluida') {
    let nfAut = false; let numNf = null;
    const espelhoExcl = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1).catch(() => []);
    if (espelhoExcl?.[0]?.numero_nf && espelhoExcl[0].status_real === 'emitida') { nfAut = true; numNf = espelhoExcl[0].numero_nf; }
    if (!nfAut && pedido.numero_nota_fiscal) { nfAut = true; numNf = pedido.numero_nota_fiscal; }
    if (!nfAut) {
      const logsAut = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: String(codigoPedido), status: 'autorizada' }, '-created_date', 1).catch(() => []);
      if (logsAut?.[0]?.numero_nf) { nfAut = true; numNf = logsAut[0].numero_nf; }
    }
    if (nfAut) {
      updates.status = 'faturado'; updates.faturado = true; updates.status_faturamento = 'faturado'; updates.numero_nota_fiscal = numNf;
      updates.data_faturamento = pedido.data_faturamento || new Date().toISOString();
      dadosCarga.etapa = '60'; dadosCarga.status_pedido = 'faturado'; dadosCarga.numero_nf = numNf;
    } else {
      updates.status = 'cancelado'; updates.data_cancelamento = new Date().toISOString(); updates.motivo_cancelamento = `Excluído no Omie (${topic})`;
      dadosCarga.etapa = 'excluido'; dadosCarga.status_pedido = 'cancelado';
    }
  } else if (topic === 'VendaProduto.Cancelada') {
    let nfAut = false; let numNf = null;
    const espelhoCanc = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1).catch(() => []);
    if (espelhoCanc?.[0]?.numero_nf && espelhoCanc[0].status_real === 'emitida') { nfAut = true; numNf = espelhoCanc[0].numero_nf; }
    if (!nfAut && pedido.numero_nota_fiscal) { nfAut = true; numNf = pedido.numero_nota_fiscal; }
    if (!nfAut) {
      const logsAut = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: String(codigoPedido), status: 'autorizada' }, '-created_date', 1).catch(() => []);
      if (logsAut?.[0]?.numero_nf) { nfAut = true; numNf = logsAut[0].numero_nf; }
    }
    if (nfAut) {
      updates.status = 'faturado'; updates.faturado = true; updates.status_faturamento = 'faturado'; updates.numero_nota_fiscal = numNf;
      updates.data_faturamento = pedido.data_faturamento || new Date().toISOString();
      dadosCarga.etapa = '60'; dadosCarga.status_pedido = 'faturado'; dadosCarga.numero_nf = numNf;
    } else {
      updates.status = 'cancelado'; updates.data_cancelamento = new Date().toISOString(); updates.motivo_cancelamento = `Cancelado no Omie (${topic})`;
      dadosCarga.etapa = '80'; dadosCarga.status_pedido = 'cancelado';
      await removerDoEspelho(base44, codigoPedido);
    }
  } else if (topic === 'VendaProduto.EtapaAlterada') {
    const etapaEvento = evt?.etapa;
    const novoStatus = mapEtapaParaStatus(etapaEvento);
    if (novoStatus) updates.status = novoStatus;
    if (String(etapaEvento || '') === '60') {
      updates.faturado = true; updates.status_faturamento = 'faturado'; updates.data_faturamento = updates.data_faturamento || new Date().toISOString();
      if (evt?.numero_nf || evt?.numero_nota) { updates.numero_nota_fiscal = String(evt.numero_nf || evt.numero_nota); dadosCarga.numero_nf = updates.numero_nota_fiscal; }
    }
    if (etapaEvento) dadosCarga.etapa = String(etapaEvento);
  } else if (topic === 'VendaProduto.Devolvida') {
    updates.status = 'cancelado'; updates.data_cancelamento = new Date().toISOString(); updates.motivo_cancelamento = 'Pedido devolvido no Omie';
    dadosCarga.etapa = '80'; dadosCarga.status_pedido = 'devolvido';
  } else if (topic === 'VendaProduto.Alterada' || topic === 'VendaProduto.Incluida') {
    return { acao: 'espelho_atualizado', pedido_id: pedido.id, espelho: espelhoAcao };
  } else {
    return { acao: 'ignorado', motivo: `topic ${topic} sem handler` };
  }

  if (Object.keys(updates).length > 0) await base44.asServiceRole.entities.Pedido.update(pedido.id, updates);
  if (Object.keys(dadosCarga).length > 0) await atualizarPedidoNaCarga(base44, codigoPedido, dadosCarga);
  return { acao: 'atualizado', pedido_id: pedido.id, espelho: espelhoAcao };
}

// Aplica numero_nf no espelho APENAS com dados do payload — NUNCA chama ConsultarPedido.
// Usado por NotaAutorizada/DevolucaoAutorizada: o id_pedido do webhook de NF frequentemente
// NÃO é consultável no Omie (faultcode 105) → consultar gera loop 105 + 6 (consumo redundante).
// Se o espelho não existir, atualiza pelo pedido local; se nenhum existir, encerra sem consultar.
async function aplicarNfNoEspelhoSemConsulta(base44, omieCodigoPedido, numeroNf) {
  if (!omieCodigoPedido) return;
  const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) }, '-sincronizado_em', 1).catch(() => []);
  if (espelhos?.[0]) {
    await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
      etapa: '60', status_real: 'emitida', status_label: 'Faturado',
      numero_nf: numeroNf ? String(numeroNf) : (espelhos[0].numero_nf || ''),
      data_faturamento: espelhos[0].data_faturamento || new Date().toISOString(),
      sincronizado_em: new Date().toISOString(), origem_sync: 'webhook'
    }).catch(() => {});
  }
}

async function handleNFe(base44, topic, evt) {
  const codigoPedido = String(evt?.idPedido || evt?.id_pedido || evt?.codigo_pedido || evt?.nCodPed || '');
  if (!codigoPedido) return { acao: 'ignorado', motivo: 'sem codigo_pedido' };

  const numNfWebhook = evt?.numero_nf || evt?.numero_nota || null;
  const xMotivo = evt?.xMotivo || evt?.cMensStatus || evt?.motivo || '';
  const cStat = evt?.cStat || '';

  if (topic === 'NFe.NotaRejeitada') {
    await upsertEspelho(base44, codigoPedido, null, { status_real: 'rejeitada', status_label: `NF Rejeitada${cStat ? ` [${cStat}]` : ''}${xMotivo ? ` — ${xMotivo}` : ''}`.slice(0, 200) });
  } else if (topic === 'NFe.NotaDenegada') {
    await upsertEspelho(base44, codigoPedido, null, { status_real: 'denegada', status_label: `NF Denegada${cStat ? ` [${cStat}]` : ''}${xMotivo ? ` — ${xMotivo}` : ''}`.slice(0, 200) });
  } else if (topic === 'NFe.NotaCancelada') {
    await upsertEspelho(base44, codigoPedido, null, { status_real: 'cancelada', status_label: 'NF Cancelada' });
  } else if (topic === 'NFe.NotaAutorizada' || topic === 'NFe.NotaDevolucaoAutorizada') {
    // Todos os dados da NF já vêm no payload — atualiza espelho SEM ConsultarPedido (evita 105/6).
    await aplicarNfNoEspelhoSemConsulta(base44, codigoPedido, numNfWebhook);
  }

  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
  if (pedidos.length === 0) return { acao: 'ignorado', motivo: 'NF sem pedido local — processada só com dados do payload', sem_pedido_local: true };

  const pedido = pedidos[0];
  const updates = {};
  const dadosCarga = {};

  if (topic === 'NFe.NotaAutorizada') {
    updates.faturado = true; updates.status = 'faturado'; updates.data_faturamento = new Date().toISOString();
    const numNf = evt?.numero_nf || evt?.numero_nota;
    if (numNf) { updates.numero_nota_fiscal = String(numNf); updates.status_faturamento = 'faturado'; dadosCarga.numero_nf = String(numNf); }
    dadosCarga.etapa = '60'; dadosCarga.status_pedido = 'faturado';
    const logsPendentes = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: codigoPedido, status: 'pendente' }, '-created_date', 5).catch(() => []);
    for (const log of logsPendentes) {
      await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, { status: 'autorizada', numero_nf: numNf ? String(numNf) : log.numero_nf || '', codigo_sefaz: '100', mensagem: 'NF emitida (etapa 60 confirmada no Omie)', boleto_gerado: false }).catch(() => {});
    }
  } else if (topic === 'NFe.NotaCancelada') {
    updates.status = 'cancelado'; updates.data_cancelamento = new Date().toISOString(); updates.motivo_cancelamento = 'NF-e cancelada no Omie';
    dadosCarga.etapa = '80'; dadosCarga.status_pedido = 'cancelado';
  } else if (topic === 'NFe.NotaDevolucaoAutorizada') {
    updates.motivo_cancelamento = 'NF-e de devolução autorizada no Omie';
    const numNf = evt?.numero_nf || evt?.numero_nota;
    if (numNf) updates.numero_nota_fiscal = String(numNf);
    dadosCarga.status_pedido = 'devolvido';
  } else if (topic === 'NFe.NotaRejeitada' || topic === 'NFe.NotaDenegada') {
    updates.faturado = false; updates.status_faturamento = topic === 'NFe.NotaDenegada' ? 'erro' : 'rejeitado';
    const motivo = topic === 'NFe.NotaDenegada' ? 'NF-e DENEGADA pela SEFAZ' : 'NF-e REJEITADA pela SEFAZ';
    const detalhe = evt?.xMotivo || evt?.cMensStatus || evt?.motivo || '';
    updates.omie_erro = `${motivo}${detalhe ? ' — ' + detalhe : ''}`.slice(0, 500);
    dadosCarga.etapa = '60'; dadosCarga.status_pedido = topic === 'NFe.NotaDenegada' ? 'nf_denegada' : 'nf_rejeitada'; dadosCarga.motivo_rejeicao = updates.omie_erro;
    const logsPendentes = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: codigoPedido, status: 'pendente' }, '-created_date', 5).catch(() => []);
    for (const log of logsPendentes) {
      await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, { status: 'rejeitada', mensagem: updates.omie_erro, faultstring: detalhe || '', codigo_sefaz: evt?.cStat || '' }).catch(() => {});
    }
  }

  if (Object.keys(updates).length > 0) await base44.asServiceRole.entities.Pedido.update(pedido.id, updates);
  if (Object.keys(dadosCarga).length > 0) await atualizarPedidoNaCarga(base44, codigoPedido, dadosCarga);
  return { acao: 'atualizado', pedido_id: pedido.id };
}

const TOPICS_SILENCIOSOS = ['RecebimentoProduto.Incluido', 'Produto.MovimentacaoEstoque'];

// Processa UM log de webhook. Retorna { acao } ou lança erro OMIE_BLOQUEADA.
async function processarUm(base44, log) {
  const topic = log.webhook_topic || log.call || '';
  let body;
  try { body = JSON.parse(log.payload_resposta || '{}'); } catch { body = {}; }
  const evt = body.event || body;

  if (TOPICS_SILENCIOSOS.includes(topic)) {
    await base44.asServiceRole.entities.LogIntegracaoOmie.update(log.id, { status: 'ignorado', mensagem_erro: null, webhook_processado_em: new Date().toISOString() }).catch(() => {});
    return { acao: 'ignorado', silencioso: true };
  }

  let resultado = { acao: 'ignorado' };
  if (topic.startsWith('VendaProduto.')) resultado = await handlePedido(base44, topic, evt);
  else if (topic.startsWith('NFe.')) resultado = await handleNFe(base44, topic, evt);
  else if (topic.startsWith('Financas.ContaReceber.')) resultado = { acao: 'logado' };
  else if (topic.startsWith('ClienteFornecedor.') || topic.startsWith('Produto.')) resultado = { acao: 'logado' };

  const statusFinal = resultado.acao === 'ignorado' ? 'ignorado' : 'processado';
  await base44.asServiceRole.entities.LogIntegracaoOmie.update(log.id, {
    status: statusFinal, webhook_processado_em: new Date().toISOString(),
    mensagem_erro: statusFinal === 'ignorado' ? (resultado.motivo || null) : null,
    payload_enviado: JSON.stringify(resultado).slice(0, 3000)
  });
  return resultado;
}

// Chave de dedupe por evento de negócio (codIntPedido/idPedido + etapa + topic).
function chaveDedupe(log) {
  let body;
  try { body = JSON.parse(log.payload_resposta || '{}'); } catch { body = {}; }
  const evt = body.event || body;
  const id = evt?.idPedido || evt?.codIntPedido || evt?.id_pedido || evt?.nCodPed || '';
  const etapa = evt?.etapa || '';
  const topic = log.webhook_topic || log.call || '';
  return `${topic}|${id}|${etapa}`;
}

// Código do pedido do evento (para dedupe inteligente por pedido na rajada).
function codigoPedidoDoLog(log) {
  let body;
  try { body = JSON.parse(log.payload_resposta || '{}'); } catch { body = {}; }
  const evt = body.event || body;
  return String(evt?.idPedido || evt?.id_pedido || evt?.codigo_pedido || evt?.nCodPed || evt?.codIntPedido || '');
}

// ─── Lock de instância única ────────────────────────────────────────────────
// Garante que só UM worker processe a fila por vez. Sem isto, o disparo por
// webhook (1 invocação por evento recebido) recriaria o problema: N workers
// concorrentes chamando a Omie em paralelo. O lock expira sozinho (LOCK_TTL_MS)
// para nunca travar permanentemente se uma execução morrer no meio.
const LOCK_TTL_MS = 180000; // 3 min — acima do teto de execução

async function tentarAdquirirLock(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID_WEBHOOK }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c) return false;
  const lockAtivo = c.worker_rodando && c.worker_lock_ate && new Date(c.worker_lock_ate).getTime() > Date.now();
  if (lockAtivo) return false;
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_WEBHOOK, {
    worker_rodando: true,
    worker_lock_ate: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
    atualizado_em: new Date().toISOString()
  }).catch(() => null);
  return true;
}

async function liberarLock(base44) {
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_WEBHOOK, {
    worker_rodando: false, worker_lock_ate: null, atualizado_em: new Date().toISOString()
  }).catch(() => null);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Permitir invocação por automação (service) ou admin autenticado.
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // LOCK DE INSTÂNCIA ÚNICA: se outra instância já está processando, sai limpo.
    // O webhook dispara este worker a cada evento recebido — sem o lock, uma rajada
    // criaria vários workers concorrentes (de volta ao problema). O scheduler de 5min
    // é a rede de segurança que pega o que sobrar.
    const adquiriu = await tentarAdquirirLock(base44);
    if (!adquiriu) {
      return Response.json({ sucesso: true, processados: 0, motivo: 'worker_ja_rodando' });
    }

    try {
      // Circuit breaker: se a Omie está bloqueando, nem começa (evita acumular erro).
      const cb = await checkCircuitBreaker(base44);
      if (cb.blocked) {
        return Response.json({ sucesso: false, motivo: 'circuit_breaker_ativo', bloqueado_ate: cb.blockedUntil, processados: 0 });
      }

      // Busca webhooks pendentes (mais antigos primeiro) — filter por chave, nunca list total.
      const pendentes = await base44.asServiceRole.entities.LogIntegracaoOmie.filter(
        { endpoint: 'webhook', status: 'pendente' }, 'created_date', MAX_POR_RODADA
      ).catch(() => []);

      if (!pendentes.length) {
        return Response.json({ sucesso: true, processados: 0, motivo: 'fila vazia' });
      }

      // DEDUPE INTELIGENTE POR PEDIDO: numa rajada chegam vários eventos do mesmo
      // codigo_pedido. Mantemos só o MAIS RECENTE de cada pedido para processar agora
      // (a fila vem ordenada por created_date asc, então o último da lista por pedido é o
      // mais novo). Os anteriores do mesmo pedido viram 'ignorado' — evita N ConsultarPedido
      // redundantes e garante que a etapa mais nova prevaleça sobre a antiga.
      const maisRecentePorPedido = new Map(); // codigo_pedido -> log
      const semPedido = []; // logs sem codigo_pedido identificável (processados normalmente)
      const aIgnorar = [];
      for (const log of pendentes) {
        const cod = codigoPedidoDoLog(log);
        if (!cod) { semPedido.push(log); continue; }
        const anterior = maisRecentePorPedido.get(cod);
        if (anterior) aIgnorar.push(anterior); // o anterior (mais antigo) é descartado
        maisRecentePorPedido.set(cod, log);
      }
      for (const log of aIgnorar) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.update(log.id, {
          status: 'ignorado', mensagem_erro: 'Consolidado (evento mais recente do mesmo pedido será processado)', webhook_processado_em: new Date().toISOString()
        }).catch(() => {});
      }

      // Ordem de chegada preservada: processa na ordem original, já sem os consolidados.
      const idsConsolidados = new Set(aIgnorar.map(l => l.id));
      const aProcessar = pendentes.filter(l => !idsConsolidados.has(l.id));

      const vistos = new Set();
      let processados = 0;
      let ignoradosDup = aIgnorar.length;
      let pausadoPorBloqueio = false;
      let chamouOmie = false;
      const inicioMs = Date.now();

      for (const log of aProcessar) {
        // Para antes do timeout — o restante fica pendente para o próximo ciclo.
        if (Date.now() - inicioMs > TEMPO_MAX_MS) break;

        // Dedupe por evento de negócio dentro desta rodada (reforço ao dedupe por pedido).
        const chave = chaveDedupe(log);
        if (vistos.has(chave)) {
          await base44.asServiceRole.entities.LogIntegracaoOmie.update(log.id, {
            status: 'ignorado', mensagem_erro: 'Duplicado (mesmo evento já processado)', webhook_processado_em: new Date().toISOString()
          }).catch(() => {});
          ignoradosDup++;
          continue;
        }
        vistos.add(chave);

        // THROTTLE GLOBAL: delay só após um item que tenha potencialmente batido na Omie.
        if (chamouOmie) await new Promise(r => setTimeout(r, DELAY_ENTRE_ITENS_MS));

        try {
          await processarUm(base44, log);
          processados++;
          // topics que podem chamar ConsultarPedido marcam para espaçar o próximo.
          const topic = log.webhook_topic || log.call || '';
          chamouOmie = topic.startsWith('VendaProduto.') || topic.startsWith('NFe.');
        } catch (e) {
          if (e.code === 'OMIE_BLOQUEADA') {
            // Re-enfileira: deixa como pendente para a próxima rodada (não vira erro).
            pausadoPorBloqueio = true;
            break;
          }
          // Erro real isolado deste webhook — marca erro e segue.
          await base44.asServiceRole.entities.LogIntegracaoOmie.update(log.id, {
            status: 'erro', mensagem_erro: String(e.message || e).slice(0, 500), webhook_processado_em: new Date().toISOString()
          }).catch(() => {});
        }
      }

      // SELF-CHAINING: se ainda há pendentes e não pausou por bloqueio, libera o lock e
      // re-dispara o worker para esvaziar a fila sem esperar o scheduler de 5min.
      let reagendado = false;
      if (!pausadoPorBloqueio) {
        const aindaPendentes = await base44.asServiceRole.entities.LogIntegracaoOmie.filter(
          { endpoint: 'webhook', status: 'pendente' }, 'created_date', 1
        ).catch(() => []);
        if (aindaPendentes.length > 0) {
          await liberarLock(base44);
          base44.asServiceRole.functions.invoke('processarFilaWebhookOmie', { origem: 'self_chain' })
            .catch((e) => console.error('[processarFilaWebhookOmie] self-chain falhou:', e?.message));
          reagendado = true;
        }
      }

      return Response.json({ sucesso: true, processados, ignorados_duplicados: ignoradosDup, pausado_por_bloqueio: pausadoPorBloqueio, reagendado });
    } finally {
      // Libera o lock sempre (se o self-chain já liberou, este update é inócuo).
      await liberarLock(base44);
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});