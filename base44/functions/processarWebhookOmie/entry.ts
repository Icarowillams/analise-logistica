import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

// ID fixo do único registro de circuit breaker — NUNCA criar novos
const CB_ID_WEBHOOK = '6a1e06a9aa62ceab7b3b6d97';

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID_WEBHOOK }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false, record: c };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_WEBHOOK, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false, record: c };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro, record: c };
}

// Extrai segundos de bloqueio da mensagem Omie (ex: "Tente novamente em 1798 segundos.")
function extrairSegundosBloqueioWH(msg) {
  const match = String(msg).match(/(\d+)\s*segundo/i);
  if (match) return Math.min(Number(match[1]), 1800);
  return 0; // sem tempo informado = não bloqueia
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
          const secsWH = extrairSegundosBloqueioWH(data.faultstring);
          { const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID_WEBHOOK }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh && secsWH > 0) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + secsWH * 1000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_WEBHOOK, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
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
// 🔄 PROCESSADOR ASSÍNCRONO DE WEBHOOK
// Disparado pela entity automation quando LogIntegracaoOmie é criado com status='pendente'.
// Roteia o evento para o handler correto e atualiza o log.

// 🔒 RATE LIMITER GLOBAL: garante no máximo 1 chamada ConsultarPedido por vez,
// com intervalo mínimo de 3s entre chamadas — evita "consumo indevido" quando
// múltiplos webhooks chegam simultâneos para pedidos diferentes.
const OMIE_CALL_MIN_INTERVAL_MS = 3000;
let _ultimaChamadaOmieTs = 0;

async function aguardarRateLimit() {
  const agora = Date.now();
  const espera = OMIE_CALL_MIN_INTERVAL_MS - (agora - _ultimaChamadaOmieTs);
  if (espera > 0) {
    console.log(`[rateLimit] aguardando ${espera}ms antes de chamar Omie`);
    await new Promise(r => setTimeout(r, espera));
  }
  _ultimaChamadaOmieTs = Date.now();
}

// Mapeia etapa Omie → status local do pedido
function mapEtapaParaStatus(etapa) {
  const e = String(etapa || '');
  if (e === '10') return 'pendente';
  if (e === '20') return 'liberado';
  if (e === '50') return 'montagem';
  if (e === '60') return 'faturado';
  if (e === '70' || e === '80') return 'cancelado';
  return null;
}

// Recalcula status da carga baseado nos pedidos dela
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

// Etapas operacionais que devem estar no espelho
const ETAPAS_ESPELHO = new Set(['10', '20', '50', '60']);

// Status NF baseado em campos do Omie / NFe
function calcularStatusNF(cabecalho, infoNfe) {
  if (infoNfe?.cStatus === 'CANCELADA' || cabecalho?.cancelado === 'S') return { status_real: 'cancelada', status_label: 'NF Cancelada' };
  if (infoNfe?.cStatus === 'DENEGADA') return { status_real: 'denegada', status_label: 'NF Denegada' };
  if (infoNfe?.cStatus === 'REJEITADA') return { status_real: 'rejeitada', status_label: 'NF Rejeitada' };
  if (infoNfe?.cStatus === 'AUTORIZADA' || infoNfe?.nNF) return { status_real: 'emitida', status_label: 'Faturado' };
  return { status_real: 'aguardando_nf', status_label: 'Aguardando NF' };
}

// 🛡️ UPSERT IDEMPOTENTE DO ESPELHO — garante 1 único registro por codigo_pedido.
// Busca TODOS os registros do pedido (não só 1). Se houver mais de um, atualiza o
// mais avançado e DELETA o resto (limpa duplicata preexistente na mesma operação).
// Se não houver nenhum, cria. Nunca gera um segundo registro.
async function upsertEspelhoUnico(base44, codigoPedido, dados) {
  const cod = String(codigoPedido);
  const existentes = await base44.asServiceRole.entities.PedidoLiberadoOmie
    .filter({ codigo_pedido: cod }, '-sincronizado_em', 50)
    .catch(() => []);
  if (!existentes.length) {
    return base44.asServiceRole.entities.PedidoLiberadoOmie.create({ codigo_pedido: cod, ...dados });
  }
  // Mantém o mais avançado (maior etapa, depois mais recente)
  const peso = (r) => (Number(r.etapa) || 0) * 1e13 + new Date(r.sincronizado_em || 0).getTime();
  existentes.sort((a, b) => peso(b) - peso(a));
  const principal = existentes[0];
  await base44.asServiceRole.entities.PedidoLiberadoOmie.update(principal.id, dados).catch((e) => { console.error('[processarWebhookOmie] falha ao atualizar espelho (upsert):', e?.message || e); });
  for (const dup of existentes.slice(1)) {
    await base44.asServiceRole.entities.PedidoLiberadoOmie.delete(dup.id).catch(() => {});
  }
  return principal;
}

// Remove pedido do espelho PedidoLiberadoOmie
async function removerDoEspelho(base44, omieCodigoPedido) {
  if (!omieCodigoPedido) return;
  const existentes = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) });
  for (const e of existentes) {
    await base44.asServiceRole.entities.PedidoLiberadoOmie.delete(e.id);
  }
}

// Insere/atualiza pedido no espelho PedidoLiberadoOmie em qualquer etapa operacional (10/20/50/60).
// Busca dados frescos via ConsultarPedido e faz o upsert.
// 🛡️ DEDUPE: pula se o mesmo pedido já foi sincronizado nos últimos 8s (evita "REDUNDANT" do Omie quando
// webhooks VendaProduto.Faturada + NFe.NotaAutorizada chegam quase simultâneos).
// 🆕 forceNumeroNf: quando passado (webhook NFe.NotaAutorizada com numero_nf), bypass do dedupe E
//                  atualiza diretamente o numero_nf no espelho sem precisar da info_nfe do ConsultarPedido.
// 🆕 forceRejeicao: { status_real, status_label, motivo } — quando vem de NFe.NotaRejeitada/Denegada/Cancelada,
//                   bypass do dedupe E aplica o status direto no espelho (não pode esperar a SEFAZ via ConsultarPedido).
async function upsertEspelho(base44, omieCodigoPedido, forceNumeroNf = null, forceRejeicao = null) {
  if (!omieCodigoPedido) return;

  // 🆕 Atalho REJEIÇÃO/CANCELAMENTO/DENEGAÇÃO: aplica status direto no espelho sem esperar ConsultarPedido
  // (a SEFAZ atualiza o cStat com atraso, e o dedupe pode ter pulado anteriormente).
  if (forceRejeicao) {
    try {
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({
        codigo_pedido: String(omieCodigoPedido)
      }, '-sincronizado_em', 1);
      const esp = espelhos[0];
      if (esp) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
          etapa: '60',
          status_real: forceRejeicao.status_real,
          status_label: forceRejeicao.status_label,
          sincronizado_em: new Date().toISOString(),
          origem_sync: 'webhook'
        });
        console.log(`[espelho] forceRejeicao=${forceRejeicao.status_real} aplicado em ${omieCodigoPedido}`);
        return;
      }
    } catch (e) {
      console.error(`[espelho] erro ao aplicar forceRejeicao:`, e.message);
    }
  }

  // 🆕 Atalho: se o webhook NFe trouxe o número, atualiza direto SEM bater no Omie (evita rate limit + perda do número).
  if (forceNumeroNf) {
    try {
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({
        codigo_pedido: String(omieCodigoPedido)
      }, '-sincronizado_em', 1);
      const esp = espelhos[0];
      if (esp) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
          etapa: '60',
          status_real: 'emitida',
          status_label: 'Faturado',
          numero_nf: String(forceNumeroNf),
          data_faturamento: esp.data_faturamento || new Date().toISOString(),
          sincronizado_em: new Date().toISOString(),
          origem_sync: 'webhook'
        });
        console.log(`[espelho] numero_nf=${forceNumeroNf} aplicado direto em ${omieCodigoPedido}`);
        return;
      }
    } catch (e) {
      console.error(`[espelho] erro ao aplicar forceNumeroNf:`, e.message);
    }
  }

  try {
    const recentes = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({
      codigo_pedido: String(omieCodigoPedido)
    }, '-sincronizado_em', 1);
    const ultimo = recentes[0];
    if (ultimo?.sincronizado_em) {
      const deltaMs = Date.now() - new Date(ultimo.sincronizado_em).getTime();
      if (deltaMs < 8000) {
        console.log(`[espelho] dedupe: ${omieCodigoPedido} sincronizado há ${deltaMs}ms — pulando`);
        return;
      }
    }
  } catch {}

  // Circuit breaker — se a API Omie está bloqueada por consumo indevido (425), não consulta agora.
  // Auto-desbloqueio: se bloqueado_ate já passou, desbloqueia automaticamente.
  const cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID_WEBHOOK }, '-created_date', 1).catch(() => []);
  const controleCb = cbRows?.[0];
  if (controleCb?.bloqueado) {
    if (controleCb.bloqueado_ate && new Date(controleCb.bloqueado_ate) <= new Date()) {
      // Expirou — desbloquear automaticamente
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_WEBHOOK, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => {});
      console.log(`[espelho] Circuit breaker expirado — auto-desbloqueado`);
    } else {
      console.log(`[espelho] API Omie bloqueada (425) — pulando ConsultarPedido de ${omieCodigoPedido} até ${controleCb.bloqueado_ate}`);
      return;
    }
  }

  const consultar = async (tentativa = 1) => {
    await aguardarRateLimit();
    const data = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(omieCodigoPedido) }, { call: 'ConsultarPedido', maxTentativas: 2 });
    if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    // 5113 / 105 / "não cadastrado": pedido não existe no Omie — TERMINAL, nunca dá retry
    // (retry só geraria consumo redundante / erro 6). Retorna null e segue.
    if (msg.includes('não existem registros') || msg.includes('nao existem registros') || msg.includes('não cadastrado') || msg.includes('nao cadastrado') || (data.faultcode && (String(data.faultcode) === '5113' || String(data.faultcode) === '105'))) {
      console.log(`[espelho] ConsultarPedido ${omieCodigoPedido}: não encontrado no Omie (105/5113) — ignorando (terminal)`);
      return null;
    }
    // 425 / consumo indevido → abre circuit breaker (bloqueio 30min) e aborta
    if (msg.includes('consumo indevido') || msg.includes('bloquead') || msg.includes('bloqueio') || msg.includes('425')) {
        const segsConsulta = extrairSegundosBloqueioWH(data.faultstring || '');
        { const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID_WEBHOOK }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring || '').slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh && segsConsulta > 0) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + segsConsulta * 1000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_WEBHOOK, _p).catch(() => {}); }
        const err = new Error(`API Omie bloqueada por consumo indevido (HTTP 425). Desbloqueio previsto: ${bloqueadoAte}.`);
        err.code = 'OMIE_425';
        throw err;
      }
      if ((msg.includes('cota') || msg.includes('aguarde')) && tentativa < 3) {
        await new Promise(r => setTimeout(r, 2500 * tentativa));
        return consultar(tentativa + 1);
      }
      throw new Error(data.faultstring);
    }
    return data.pedido_venda_produto;
  };

  const pedidoBruto = await consultar();
  if (!pedidoBruto || !pedidoBruto?.cabecalho) return;
  const etapa = String(pedidoBruto.cabecalho.etapa || '');

  // Se etapa não é operacional (ex: 70/80 = cancelado), remove do espelho
  if (!ETAPAS_ESPELHO.has(etapa)) {
    await removerDoEspelho(base44, omieCodigoPedido);
    return;
  }

  // Enriquecer com cliente local — busca DETERMINÍSTICA por código (sem depender de paginação)
  const codigoClienteOmie = String(pedidoBruto.cabecalho.codigo_cliente || '');
  const [
    clientesPorIntegracao,
    clientesPorInterno,
    clientesPorOmie,
    pedidosLocais
  ] = await Promise.all([
    base44.asServiceRole.entities.Cliente.filter({ codigo_integracao: codigoClienteOmie }, '-created_date', 5),
    base44.asServiceRole.entities.Cliente.filter({ codigo_interno: codigoClienteOmie }, '-created_date', 5),
    base44.asServiceRole.entities.Cliente.filter({ codigo_omie: codigoClienteOmie }, '-created_date', 5),
    base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(omieCodigoPedido) })
  ]);

  const cliente =
    clientesPorIntegracao[0] ||
    clientesPorInterno[0] ||
    clientesPorOmie[0] ||
    null;

  const pedidoLocal = pedidosLocais[0] || null;

  // Resolve rota e vendedor pelo ID — busca direta (1 registro), sem paginação
  const rotaIdEfetivo = cliente?.rota_id || pedidoLocal?.rota_id || null;
  const vendedorIdEfetivo = cliente?.vendedor_id || pedidoLocal?.vendedor_id || null;

  const [rotaRec, vendedorRec] = await Promise.all([
    rotaIdEfetivo
      ? base44.asServiceRole.entities.Rota.filter({ id: rotaIdEfetivo }, '-created_date', 1).catch(() => [])
      : Promise.resolve([]),
    vendedorIdEfetivo
      ? base44.asServiceRole.entities.Vendedor.filter({ id: vendedorIdEfetivo }, '-created_date', 1).catch(() => [])
      : Promise.resolve([])
  ]);

  const rotaNome = rotaRec[0]?.nome || pedidoLocal?.rota_nome || '';
  const vendedorNome = vendedorRec[0]?.nome || pedidoLocal?.vendedor_nome || '';

  // 🆕 Resolver tipo_operacao (venda/bonificacao/troca/devolucao/remessa)
  // Prioridade:
  //   1. pedidoLocal.tipo (já tem essa info no Pedido)
  //   2. Cenário fiscal Omie do pedido → mapeia via CenarioFiscalLocal (cenario_omie_codigo) → tipo_operacao
  let tipoOperacao = pedidoLocal?.tipo || null;
  if (!tipoOperacao) {
    const codCenarioOmie = String(pedidoBruto.cabecalho.codigo_cenario || pedidoBruto.cabecalho.codigo_parcela || '');
    if (codCenarioOmie) {
      const cenariosLocais = await base44.asServiceRole.entities.CenarioFiscalLocal
        .filter({ cenario_omie_codigo: codCenarioOmie }, '-created_date', 1)
        .catch(() => []);
      tipoOperacao = cenariosLocais[0]?.tipo_operacao || null;
    }
  }
  tipoOperacao = tipoOperacao || 'venda';

  // Status NF: etapa 60 = leitura normal da NF; etapa 50 = aguardando (transitório normal após FaturarPedidoVenda)
  // ⚠️ NÃO marcamos etapa 50 como rejeitada — esse é o estado padrão enquanto a SEFAZ processa.
  // Rejeição real só vem por: (a) cStat>=200 no infoNfe (capturado abaixo) ou (b) webhook NFe.NotaRejeitada/Denegada.
  const infoNfe = pedidoBruto.infoNfe || pedidoBruto.info_nf || null;
  const numeroNf = String(infoNfe?.nNF || infoNfe?.numero_nf || pedidoBruto.cabecalho?.numero_nfe || '');
  const cStatNfe = String(infoNfe?.cStat || '');
  const xMotivoNfe = infoNfe?.xMotivo || infoNfe?.cMensStatus || '';
  let statusNf;
  if (etapa === '60') {
    statusNf = calcularStatusNF(pedidoBruto.cabecalho, infoNfe);
  } else if (etapa === '50' && cStatNfe && Number(cStatNfe) >= 200 && !['100','101','135','150'].includes(cStatNfe)) {
    // Rejeição EXPLÍCITA confirmada pela SEFAZ via cStat>=200
    statusNf = {
      status_real: ['110','301','302','205'].includes(cStatNfe) ? 'denegada' : 'rejeitada',
      status_label: `[SEFAZ ${cStatNfe}] ${xMotivoNfe || 'NF rejeitada'}`
    };
  } else if (etapa === '50') {
    statusNf = { status_real: 'aguardando_nf', status_label: 'Aguardando processamento SEFAZ' };
  } else {
    statusNf = { status_real: null, status_label: null };
  }

  const registro = {
    codigo_pedido: String(omieCodigoPedido),
    codigo_pedido_integracao: pedidoBruto.cabecalho.codigo_pedido_integracao || '',
    numero_pedido: String(pedidoBruto.cabecalho.numero_pedido || ''),
    etapa,
    status_real: statusNf.status_real,
    status_label: statusNf.status_label,
    numero_nf: numeroNf,
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
    tipo_operacao: tipoOperacao,
    tags_cliente: cliente?.tags || [],
    motorista_padrao_id: cliente?.motorista_id || null,
    rota_id: cliente?.rota_id || pedidoLocal?.rota_id || null,
    rota_nome: rotaNome || 'Sem Rota',
    rota_cliente: rotaNome || 'Sem Rota',
    vendedor_id: cliente?.vendedor_id || pedidoLocal?.vendedor_id || null,
    vendedor_nome: vendedorNome,
    data_previsao: pedidoBruto.cabecalho.data_previsao || '',
    quantidade_itens: (pedidoBruto.det || []).length,
    valor_total_pedido: pedidoBruto.total_pedido?.valor_total_pedido || 0,
    pedido_id: pedidoLocal?.id || null,
    produtos: (pedidoBruto.det || []).map(d => ({
      codigo_produto: String(d.produto?.codigo_produto || ''),
      codigo_produto_integracao: d.produto?.codigo_produto_integracao || '',
      descricao: d.produto?.descricao || '',
      quantidade: d.produto?.quantidade || 0,
      valor_unitario: d.produto?.valor_unitario || 0,
      valor_total: d.produto?.valor_total || 0,
      unidade: d.produto?.unidade || ''
    })),
    sincronizado_em: new Date().toISOString(),
    origem_sync: 'webhook'
  };

  await upsertEspelhoUnico(base44, omieCodigoPedido, registro);
}

// Atualiza pedido dentro da carga e recalcula status da carga
// 🛡️ INTEGRIDADE: numero_nf já preenchido NUNCA é sobrescrito com vazio/null.
//    Toda atualização de numero_nf gera log "atualizacao_espelho_carga_nf".
async function atualizarPedidoNaCarga(base44, omieCodigoPedido, dadosAtualizados) {
  if (!omieCodigoPedido) return;

  // ESTRATÉGIA 1 — busca direta via Pedido.carga_id (O(1), sem scan)
  let cargaAlvo = null;
  const pedidosLocais = await base44.asServiceRole.entities.Pedido
    .filter({ omie_codigo_pedido: String(omieCodigoPedido) }, '-created_date', 1)
    .catch(() => []);
  const cargaId = pedidosLocais?.[0]?.carga_id;
  if (cargaId) {
    cargaAlvo = await base44.asServiceRole.entities.Carga.get(cargaId).catch(() => null);
  }

  // ESTRATÉGIA 2 — fallback: filtrar cargas ativas (montagem/faturada), nunca todas
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

    // Clona os dados a aplicar; protege numero_nf de ser apagado.
    const dadosSeguros = { ...dadosAtualizados };
    let nfFoiVinculada = false;
    if ('numero_nf' in dadosAtualizados) {
      if (!nfNova) {
        // Tentativa de apagar a NF — ignorada se já havia NF preenchida.
        delete dadosSeguros.numero_nf;
      } else if (nfAtual && nfAtual !== nfNova) {
        // Só troca para outro número válido (nunca para vazio).
        nfFoiVinculada = true;
      } else if (!nfAtual) {
        nfFoiVinculada = true;
      }
    }

    const novosPedidos = pedidos.map((p, i) => i === idx ? { ...p, ...dadosSeguros } : p);
    const novoStatus = recalcularStatusCarga(novosPedidos, carga.status_carga);

    const updates = { pedidos_omie: novosPedidos };
    if (novoStatus !== carga.status_carga) updates.status_carga = novoStatus;
    if (novoStatus === 'faturada' && !carga.data_faturamento) updates.data_faturamento = new Date().toISOString();

    await base44.asServiceRole.entities.Carga.update(carga.id, updates);
    console.log(`[processarWebhookOmie] Carga ${carga.numero_carga} → status: ${novoStatus} (pedido ${omieCodigoPedido} atualizado)`);

    // Log da vinculação de NF no espelho da carga.
    if (nfFoiVinculada) {
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'webhook',
        call: 'atualizacao_espelho_carga_nf',
        operacao: 'atualizacao_espelho_carga_nf',
        entidade_tipo: 'Carga',
        entidade_id: carga.id,
        status: 'sucesso',
        payload_resposta: JSON.stringify({
          carga_id: carga.id,
          numero_carga: carga.numero_carga,
          pedido_id: omieCodigoPedido,
          numero_pedido: pedidoAtual.numero_pedido || '',
          numero_nf: nfNova,
          campos_alterados: Object.keys(dadosSeguros),
          motivo: 'NF vinculada ao pedido no espelho da carga via webhook'
        }).slice(0, 2000)
      }).catch(() => {});
    }
    return; // pedido só pode estar em 1 carga
  }
}

// === HANDLERS POR DOMÍNIO ===

// 🛡️ REGRA DE SEGURANÇA DE CANCELAMENTO
// Decide como aplicar um cancelamento/exclusão/devolução vindo do Omie ao Pedido local,
// preservando rastreabilidade financeira:
//   - Pré-faturamento (pendente/liberado/montagem, sem NF) → status='cancelado'. Seguro.
//   - Já faturado (status='faturado' OU tem NF/data_faturamento) → NÃO vira 'cancelado' cego
//     (sumiria de relatórios). Usa status='cancelado_pos_faturamento' + cancelado_no_omie=true,
//     mantendo numero_nota_fiscal/data_faturamento intactos.
// Idempotente: se já está no status final correto, não força nada novo além da marca.
function montarUpdatesCancelamento(pedido, motivo) {
  const jaFaturado = pedido.status === 'faturado'
    || pedido.faturado === true
    || !!pedido.numero_nota_fiscal
    || !!pedido.data_faturamento
    || pedido.status === 'cancelado_pos_faturamento';
  const updates = {
    cancelado_no_omie: true,
    data_cancelamento: pedido.data_cancelamento || new Date().toISOString(),
    motivo_cancelamento: pedido.motivo_cancelamento || motivo
  };
  if (jaFaturado) {
    // Preserva NF/faturamento; só marca o cancelamento pós-faturamento.
    updates.status = 'cancelado_pos_faturamento';
  } else {
    updates.status = 'cancelado';
  }
  return { updates, jaFaturado };
}

async function handlePedido(base44, topic, evt) {
  const codigoPedido = String(
    evt?.idPedido || evt?.id_pedido || evt?.codigo_pedido || evt?.nCodPed || ''
  );
  if (!codigoPedido) return { acao: 'ignorado', motivo: 'sem codigo_pedido' };

  // 🔄 ESPELHO OPERAÇÃO: manter PedidoLiberadoOmie em tempo real (etapas 10/20/50/60)
  // - Cancelamento/exclusão/devolução → remove (exceto bonificação com NF autorizada)
  // - Faturada → upsert (vai pra etapa 60)
  // - EtapaAlterada / Incluida / Alterada → upsert (decide etapa via ConsultarPedido)
  let espelhoAcao = null;
  try {
    if (topic === 'VendaProduto.Excluida' || topic === 'VendaProduto.Devolvida') {
      await removerDoEspelho(base44, codigoPedido);
      espelhoAcao = 'removido';
    } else if (topic === 'VendaProduto.Cancelada') {
      espelhoAcao = 'cancelada_verificar_nf';
    } else if (topic === 'VendaProduto.Faturada') {
      // Faturada: NÃO chama ConsultarPedido (economiza 1 chamada Omie).
      // O webhook NFe.NotaAutorizada que vem logo depois aplica o numero_nf via forceNumeroNf.
      // Apenas faz upsert rápido com dados do evento (sem bater no Omie).
      try {
        const existeEsp = await base44.asServiceRole.entities.PedidoLiberadoOmie
          .filter({ codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1).catch(() => []);
        const numNfExistente = existeEsp?.[0]?.numero_nf || '';
        // Busca pedido local só se precisar criar (espelho ainda não existe)
        const pl = existeEsp?.length ? null : ((await base44.asServiceRole.entities.Pedido
          .filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1).catch(() => []))[0] || null);
        await upsertEspelhoUnico(base44, codigoPedido, {
          numero_pedido: existeEsp?.[0]?.numero_pedido || pl?.numero_pedido || evt?.numero_pedido || '',
          etapa: '60',
          status_real: 'aguardando_nf',
          status_label: 'Aguardando NF',
          numero_nf: evt?.numero_nf ? String(evt.numero_nf) : numNfExistente,
          ...(pl ? {
            cliente_id: pl.cliente_id || null,
            nome_cliente: pl.cliente_nome || '',
            nome_fantasia: pl.cliente_nome_fantasia || '',
            cidade: pl.cliente_cidade || '',
            rota_id: pl.rota_id || null,
            rota_nome: pl.rota_nome || '',
            vendedor_id: pl.vendedor_id || null,
            vendedor_nome: pl.vendedor_nome || '',
            valor_total_pedido: pl.valor_total || 0,
            pedido_id: pl.id || null
          } : {}),
          sincronizado_em: new Date().toISOString(),
          origem_sync: 'webhook'
        });
      } catch (e) {
        console.error(`[espelho] VendaProduto.Faturada erro ao atualizar espelho ${codigoPedido}:`, e.message);
      }
      espelhoAcao = 'upsert_local';
    } else if (topic === 'VendaProduto.Incluida') {
      // Incluida: se o pedido JÁ existe no Base44 (enviado pela fila), NÃO consultar Omie.
      // O espelho será atualizado pela reconciliação periódica. Evita rate limit.
      const jaExisteLocal = await base44.asServiceRole.entities.Pedido
        .filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1)
        .catch(() => []);
      if (jaExisteLocal.length > 0) {
        // Pedido local encontrado — atualiza espelho com dados locais (sem bater no Omie)
        try {
          const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({
            codigo_pedido: String(codigoPedido)
          }, '-sincronizado_em', 1);
          if (!espelhos.length) {
            // Cria espelho mínimo (idempotente) com dados do pedido local
            const pl = jaExisteLocal[0];
            await upsertEspelhoUnico(base44, codigoPedido, {
              numero_pedido: pl.numero_pedido || '',
              etapa: evt?.etapa || '10',
              cliente_id: pl.cliente_id || null,
              nome_cliente: pl.cliente_nome || '',
              nome_fantasia: pl.cliente_nome_fantasia || '',
              cidade: pl.cliente_cidade || '',
              rota_id: pl.rota_id || null,
              rota_nome: pl.rota_nome || '',
              vendedor_id: pl.vendedor_id || null,
              vendedor_nome: pl.vendedor_nome || '',
              valor_total_pedido: pl.valor_total || 0,
              pedido_id: pl.id,
              sincronizado_em: new Date().toISOString(),
              origem_sync: 'webhook'
            });
          }
        } catch {}
        espelhoAcao = 'upsert_local_skip_omie';
        console.log(`[espelhoOperacao] VendaProduto.Incluida ${codigoPedido} — pedido local encontrado, pular ConsultarPedido`);
      } else {
        // Pedido NÃO é nosso — consulta Omie normalmente
        await upsertEspelho(base44, codigoPedido);
        espelhoAcao = 'upsert';
      }
    } else if (
      topic === 'VendaProduto.EtapaAlterada' ||
      topic === 'VendaProduto.Alterada'
    ) {
      // 🚀 OTIMIZAÇÃO: EtapaAlterada já traz a etapa no payload.
      // Para etapas 10 (Pendente) e 20 (Liberado) — apenas atualiza o espelho com dados locais
      // SEM chamar ConsultarPedido (evita rate limit quando muitos pedidos são liberados em lote).
      // Etapas 50 (Em Faturamento) e 60 (Faturado) ainda precisam do ConsultarPedido para NF + produtos.
      const etapaEvtEspelho = String(evt?.etapa || '');
      if (etapaEvtEspelho === '10' || etapaEvtEspelho === '20') {
        try {
          const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({
            codigo_pedido: String(codigoPedido)
          }, '-sincronizado_em', 1);
          const novoStatusEspelho = etapaEvtEspelho === '20' ? 'Pedido Liberado' : 'Pedido Pendente';
          // 🛡️ COERÊNCIA: NUNCA rebaixar a etapa de um espelho já faturado (60/emitida).
          // Webhooks de EtapaAlterada→20 chegam fora de ordem; ignorar se já está faturado evita
          // o estado impossível "emitida + etapa 20" que causava a leitura inconsistente.
          if (espelhos?.[0] && (String(espelhos[0].etapa) === '60' || espelhos[0].status_real === 'emitida')) {
            console.log(`[espelho] EtapaAlterada→${etapaEvtEspelho} ignorada para ${codigoPedido} — espelho já faturado (60/emitida)`);
            espelhoAcao = 'skip_etapa_ja_faturado';
          } else if (espelhos?.[0]) {
            await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
              etapa: etapaEvtEspelho,
              status_label: novoStatusEspelho,
              sincronizado_em: new Date().toISOString(),
              origem_sync: 'webhook'
            });
            espelhoAcao = 'upsert_local_etapa';
          } else {
            // Espelho não existe — busca pedido local para criar registro mínimo
            const pedidosLocaisEt = await base44.asServiceRole.entities.Pedido
              .filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1)
              .catch(() => []);
            const pl = pedidosLocaisEt[0];
            if (pl) {
              await upsertEspelhoUnico(base44, codigoPedido, {
                numero_pedido: pl.numero_pedido || String(evt?.numeroPedido || ''),
                etapa: etapaEvtEspelho,
                status_label: novoStatusEspelho,
                cliente_id: pl.cliente_id || null,
                nome_cliente: pl.cliente_nome || '',
                nome_fantasia: pl.cliente_nome_fantasia || '',
                cidade: pl.cliente_cidade || '',
                rota_id: pl.rota_id || null,
                rota_nome: pl.rota_nome || '',
                vendedor_id: pl.vendedor_id || null,
                vendedor_nome: pl.vendedor_nome || '',
                valor_total_pedido: pl.valor_total || 0,
                pedido_id: pl.id,
                sincronizado_em: new Date().toISOString(),
                origem_sync: 'webhook'
              });
              espelhoAcao = 'upsert_local_etapa';
            } else {
              // 🆕 PEDIDO ÓRFÃO (faturado direto no Omie, sem pedido local) —
              // consulta o Omie e cria o espelho a partir dos dados reais (idempotente).
              console.log(`[espelho] EtapaAlterada ${codigoPedido} etapa ${etapaEvtEspelho} — sem pedido local, criando espelho de órfão via ConsultarPedido`);
              await upsertEspelho(base44, codigoPedido);
              espelhoAcao = 'upsert_orfao';
            }
          }
          if (!espelhoAcao) espelhoAcao = 'upsert_local_etapa';
        } catch (e) {
          console.error(`[espelho] EtapaAlterada local erro ${codigoPedido}:`, e.message);
        }
      } else {
        // Etapa 50/60 ou desconhecida — consulta Omie normalmente
        await upsertEspelho(base44, codigoPedido);
        espelhoAcao = 'upsert';
      }
    }
  } catch (e) {
    console.error(`[espelhoOperacao] erro ao sincronizar ${codigoPedido}:`, e.message);
  }

  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
  if (pedidos.length === 0) {
    // Pedido órfão (não existe no Base44). Se o espelho foi criado/atualizado via ConsultarPedido,
    // o pedido passa a aparecer em Gerenciar Pedidos em tempo real — não é mais só "ignorado".
    if (espelhoAcao === 'upsert' || espelhoAcao === 'upsert_orfao') {
      return { acao: 'espelho_criado_orfao', motivo: 'pedido órfão sincronizado no espelho via ConsultarPedido', espelho: espelhoAcao };
    }
    return { acao: 'ignorado', motivo: 'pedido não encontrado no Base44', espelho: espelhoAcao };
  }

  const pedido = pedidos[0];
  const updates = {};
  const dadosCarga = {};

  if (topic === 'VendaProduto.Faturada') {
    updates.status = 'faturado';
    updates.faturado = true;
    updates.status_faturamento = 'faturado';
    updates.data_faturamento = new Date().toISOString();
    if (evt?.numero_nf) {
      updates.numero_nota_fiscal = String(evt.numero_nf);
      dadosCarga.numero_nf = String(evt.numero_nf);
    }
    dadosCarga.etapa = '60';
    dadosCarga.status_pedido = 'faturado';

    // Atualizar LogEmissaoNF pendente → autorizada (se existir)
    try {
      const logsPendentes = await base44.asServiceRole.entities.LogEmissaoNF.filter(
        { codigo_pedido: codigoPedido, status: 'pendente' }, '-created_date', 5
      ).catch(() => []);
      for (const log of logsPendentes) {
        await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, {
          status: 'autorizada',
          numero_nf: evt?.numero_nf ? String(evt.numero_nf) : log.numero_nf || '',
          codigo_sefaz: '100',
          mensagem: 'NF emitida (etapa 60 confirmada no Omie)',
          boleto_gerado: false
        }).catch(() => {});
      }
    } catch (e) {
      console.error(`[handlePedido] erro ao atualizar LogEmissaoNF pendente:`, e.message);
    }

    // 🤖 Boleto automático ao faturar — SÓ para pedido A PRAZO.
    // ⚡ NÃO gera inline (isso causava a rajada de boletos que estourava o rate limit global).
    // Apenas ENFILEIRA em FilaBoletoOmie; o worker processarFilaBoletoOmie processa espaçado,
    // em baixa prioridade, cedendo a vez para webhooks/NF.
    try {
      const ehAVista = /vista/i.test(pedido.plano_pagamento_nome || '');
      if (ehAVista) {
        console.log(`[boleto-fila] pedido ${codigoPedido} é À VISTA — não gera boleto`);
      } else {
        const jaNaFila = await base44.asServiceRole.entities.FilaBoletoOmie.filter(
          { codigo_pedido: String(codigoPedido) }, '-created_date', 1
        ).catch(() => []);
        const naoFinalizado = jaNaFila?.[0] && ['pendente', 'processando'].includes(jaNaFila[0].status);
        if (!naoFinalizado) {
          await base44.asServiceRole.entities.FilaBoletoOmie.create({
            codigo_pedido: String(codigoPedido),
            numero_pedido: pedido.numero_pedido || '',
            origem: 'webhook',
            status: 'pendente',
            tentativas: 0
          }).catch(() => {});
          console.log(`[boleto-fila] pedido ${codigoPedido} enfileirado para geração de boleto`);
        }
      }
    } catch (e) {
      console.error(`[boleto-fila] erro ao enfileirar ${codigoPedido}:`, e.message);
    }
  } else if (topic === 'VendaProduto.Excluida') {
    // Verificar NF autorizada LOCALMENTE antes de chamar Omie
    let nfAutorizadaExcluida = false;
    let numeroNfExcluida = null;

    // 1) Checar espelho local
    const espelhoExcl = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
      { codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1
    ).catch(() => []);
    if (espelhoExcl?.[0]?.numero_nf && espelhoExcl[0].status_real === 'emitida') {
      nfAutorizadaExcluida = true;
      numeroNfExcluida = espelhoExcl[0].numero_nf;
    }
    // 2) Checar Pedido local
    if (!nfAutorizadaExcluida && pedido.numero_nota_fiscal) {
      nfAutorizadaExcluida = true;
      numeroNfExcluida = pedido.numero_nota_fiscal;
    }
    // 3) Checar LogEmissaoNF autorizada
    if (!nfAutorizadaExcluida) {
      const logsAutExcl = await base44.asServiceRole.entities.LogEmissaoNF.filter(
        { codigo_pedido: String(codigoPedido), status: 'autorizada' }, '-created_date', 1
      ).catch(() => []);
      if (logsAutExcl?.[0]?.numero_nf) {
        nfAutorizadaExcluida = true;
        numeroNfExcluida = logsAutExcl[0].numero_nf;
      }
    }
    // 4) Fallback: Omie apenas se necessário
    if (!nfAutorizadaExcluida) {
      try {
        const nfData = await omieCall(base44, 'produtos/nfconsultar/', { nIdPedido: Number(codigoPedido) }, { call: 'ConsultarNF', skipLog: true });
        if (nfData?.ide?.nNF) {
          const dCan = String(nfData.ide?.dCan || '').trim();
          const cDeneg = String(nfData.ide?.cDeneg || '').trim();
          if (!dCan && cDeneg !== 'S' && cDeneg !== 'D') {
            nfAutorizadaExcluida = true;
            numeroNfExcluida = String(nfData.ide.nNF);
          }
        }
      } catch (e) {
        console.warn(`[webhook] Erro ao consultar NF do pedido excluído ${pedido.numero_pedido}: ${e.message}`);
      }
    }

    if (nfAutorizadaExcluida) {
      // NF autorizada encontrada — NÃO cancelar, sincronizar como faturado
      console.log(`[webhook] VendaProduto.Excluida ignorada para ${pedido.numero_pedido} — NF ${numeroNfExcluida} autorizada`);
      updates.status = 'faturado';
      updates.faturado = true;
      updates.status_faturamento = 'faturado';
      updates.numero_nota_fiscal = numeroNfExcluida;
      updates.data_faturamento = pedido.data_faturamento || new Date().toISOString();
      dadosCarga.etapa = '60';
      dadosCarga.status_pedido = 'faturado';
      dadosCarga.numero_nf = numeroNfExcluida;
      try { await upsertEspelho(base44, codigoPedido, numeroNfExcluida); } catch {}
      // Log de proteção
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'webhook', call: 'VendaProduto.Excluida', operacao: 'protecao_nf_autorizada',
        entidade_tipo: 'Pedido', entidade_id: pedido.id, status: 'sucesso',
        mensagem_erro: `VendaProduto.Excluida ignorada — NF ${numeroNfExcluida} autorizada encontrada`,
        payload_resposta: JSON.stringify({ numero_pedido: pedido.numero_pedido, numero_nf: numeroNfExcluida }).slice(0, 2000)
      }).catch(() => {});
    } else {
      const { updates: u, jaFaturado } = montarUpdatesCancelamento(pedido, `Excluído no Omie (${topic})`);
      Object.assign(updates, u);
      dadosCarga.etapa = 'excluido';
      dadosCarga.status_pedido = jaFaturado ? 'cancelado_pos_faturamento' : 'cancelado';
    }
  } else if (topic === 'VendaProduto.Cancelada') {
    // Verificar se existe NF autorizada LOCALMENTE antes de chamar Omie.
    // Prioridade: dados locais (espelho + Pedido + LogEmissaoNF) → evita chamada API.
    let nfAutorizada = false;
    let numeroNfBonif = null;

    // 1) Checar espelho local
    const espelhoCanc = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
      { codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1
    ).catch(() => []);
    if (espelhoCanc?.[0]?.numero_nf && espelhoCanc[0].status_real === 'emitida') {
      nfAutorizada = true;
      numeroNfBonif = espelhoCanc[0].numero_nf;
    }
    // 2) Checar Pedido local
    if (!nfAutorizada && pedido.numero_nota_fiscal) {
      nfAutorizada = true;
      numeroNfBonif = pedido.numero_nota_fiscal;
    }
    // 3) Checar LogEmissaoNF autorizada
    if (!nfAutorizada) {
      const logsAut = await base44.asServiceRole.entities.LogEmissaoNF.filter(
        { codigo_pedido: String(codigoPedido), status: 'autorizada' }, '-created_date', 1
      ).catch(() => []);
      if (logsAut?.[0]?.numero_nf) {
        nfAutorizada = true;
        numeroNfBonif = logsAut[0].numero_nf;
      }
    }
    // 4) Fallback: consultar Omie APENAS se nenhum dado local confirmou NF
    if (!nfAutorizada) {
      try {
        const nfData = await omieCall(base44, 'produtos/nfconsultar/', { nIdPedido: Number(codigoPedido) }, { call: 'ConsultarNF', skipLog: true });
        if (nfData?.ide?.nNF) {
          const dCan = String(nfData.ide?.dCan || '').trim();
          const cDeneg = String(nfData.ide?.cDeneg || '').trim();
          if (!dCan && cDeneg !== 'S' && cDeneg !== 'D') {
            nfAutorizada = true;
            numeroNfBonif = String(nfData.ide.nNF);
          }
        }
      } catch (e) {
        console.warn(`[webhook] Erro ao consultar NF do pedido ${pedido.numero_pedido}: ${e.message}`);
      }
    }

    if (nfAutorizada) {
      // NF autorizada — sincronizar como faturado, NÃO cancelar
      console.log(`[webhook] Pedido ${pedido.numero_pedido} (tipo=${pedido.tipo}) com NF ${numeroNfBonif} AUTORIZADA — sincronizando como faturado (VendaProduto.Cancelada ignorada)`);
      updates.status = 'faturado';
      updates.faturado = true;
      updates.status_faturamento = 'faturado';
      updates.numero_nota_fiscal = numeroNfBonif;
      updates.data_faturamento = pedido.data_faturamento || new Date().toISOString();
      dadosCarga.etapa = '60';
      dadosCarga.status_pedido = 'faturado';
      dadosCarga.numero_nf = numeroNfBonif;
      // Atualizar espelho em vez de remover
      try {
        await upsertEspelho(base44, codigoPedido, numeroNfBonif);
      } catch (e) {
        console.warn(`[webhook] Erro ao atualizar espelho do pedido: ${e.message}`);
      }
    } else {
      // Cancelamento real — com regra de segurança pré/pós-faturamento
      const { updates: u, jaFaturado } = montarUpdatesCancelamento(pedido, `Cancelado no Omie (${topic})`);
      Object.assign(updates, u);
      dadosCarga.etapa = '80';
      dadosCarga.status_pedido = jaFaturado ? 'cancelado_pos_faturamento' : 'cancelado';
      // Remover do espelho
      try { await removerDoEspelho(base44, codigoPedido); } catch {}
    }
  } else if (topic === 'VendaProduto.EtapaAlterada') {
    // A etapa já vem no payload do webhook — usar diretamente sem consultar o espelho
    let etapaEvento = evt?.etapa;
    // Fallback apenas se o webhook não trouxe a etapa
    if (!etapaEvento) {
      try {
        const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
          { codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1
        ).catch(() => []);
        etapaEvento = espelhos[0]?.etapa;
      } catch {}
    }
    // ⚠️ BLINDAGEM FISCAL: EtapaAlterada NUNCA cancela um pedido por número de etapa.
    // Etapa 70/80 no Omie NÃO significa cancelamento (70 = concluído/pós-faturamento).
    // Cancelamento só vem dos topics dedicados (Cancelada/Excluida/Devolvida), que checam
    // NF autorizada antes. Aqui só aplicamos AVANÇO de fluxo seguro (10/20/50/60); qualquer
    // outra etapa (70/80/etc.) não altera o status local — evita "cancelado" fantasma
    // gravado sem rastro em pedidos faturados.
    const etapaStrEvt = String(etapaEvento || '');
    const novoStatus = ['10', '20', '50', '60'].includes(etapaStrEvt) ? mapEtapaParaStatus(etapaEvento) : null;
    // Nunca rebaixar um pedido já faturado por um evento de etapa anterior fora de ordem.
    const jaFaturadoLocal = pedido.status === 'faturado' || pedido.faturado === true || !!pedido.numero_nota_fiscal;
    if (novoStatus && !(jaFaturadoLocal && novoStatus !== 'faturado')) updates.status = novoStatus;
    if (String(etapaEvento || '') === '60') {
      updates.faturado = true;
      updates.status_faturamento = 'faturado';
      updates.data_faturamento = updates.data_faturamento || new Date().toISOString();
      if (evt?.numero_nf || evt?.numero_nota) {
        updates.numero_nota_fiscal = String(evt.numero_nf || evt.numero_nota);
        dadosCarga.numero_nf = updates.numero_nota_fiscal;
      }
    }
    if (etapaEvento) dadosCarga.etapa = String(etapaEvento);
  } else if (topic === 'VendaProduto.Devolvida') {
    const { updates: u, jaFaturado } = montarUpdatesCancelamento(pedido, 'Pedido devolvido no Omie');
    Object.assign(updates, u);
    dadosCarga.etapa = '80';
    dadosCarga.status_pedido = 'devolvido';
  } else if (topic === 'VendaProduto.Alterada' || topic === 'VendaProduto.Incluida') {
    // Esses topics já fazem upsert do espelho (PedidoLiberadoOmie) acima.
    // O Pedido local não precisa de atualização — apenas confirma que foi processado.
    return { acao: 'espelho_atualizado', pedido_id: pedido.id, espelho: espelhoAcao, motivo: `${topic} — espelho sincronizado, pedido local sem alteração` };
  } else {
    return { acao: 'ignorado', motivo: `topic ${topic} sem handler` };
  }

  if (Object.keys(updates).length > 0) {
    await base44.asServiceRole.entities.Pedido.update(pedido.id, updates);
  }
  if (Object.keys(dadosCarga).length > 0) {
    await atualizarPedidoNaCarga(base44, codigoPedido, dadosCarga);
  }

  return { acao: 'atualizado', pedido_id: pedido.id, updates, espelho: espelhoAcao };
}

// 🤖 Dispara geração automática de boleto para um pedido (best-effort, não bloqueia)
// 🐛 FIX: Referenciava 'gerarBoletosAutoPedidos' que NÃO EXISTE — corrigido para 'gerarBoletosOmie' (origem=auto)
async function gerarBoletoAuto(base44, codigoPedido) {
  if (!codigoPedido) return { ok: false };
  try {
    const res = await base44.functions.invoke('gerarBoletosOmie', {
      origem: 'auto',
      pedidos: [{ codigo_pedido: String(codigoPedido) }]
    });
    return { ok: true, data: res?.data };
  } catch (e) {
    console.error(`[gerarBoletoAuto] erro pedido ${codigoPedido}:`, e.message);
    return { ok: false, erro: e.message };
  }
}

// Aplica numero_nf no espelho APENAS com dados do payload — NUNCA chama ConsultarPedido.
// Usado por NotaAutorizada/DevolucaoAutorizada: o id_pedido do webhook de NF frequentemente
// NÃO é consultável no Omie (faultcode 105) → consultar gera loop 105 + 6 (consumo redundante).
async function aplicarNfNoEspelhoSemConsulta(base44, omieCodigoPedido, numeroNf) {
  if (!omieCodigoPedido) return;
  const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) }, '-sincronizado_em', 1).catch(() => []);
  if (!espelhos?.length) return; // só aplica se já existe espelho (não cria órfão aqui)
  // upsertEspelhoUnico atualiza o principal e remove duplicatas — garante 1 registro coerente (60/emitida).
  await upsertEspelhoUnico(base44, omieCodigoPedido, {
    etapa: '60', status_real: 'emitida', status_label: 'Faturado',
    numero_nf: numeroNf ? String(numeroNf) : (espelhos[0].numero_nf || ''),
    data_faturamento: espelhos[0].data_faturamento || new Date().toISOString(),
    sincronizado_em: new Date().toISOString(), origem_sync: 'webhook'
  });
}

async function handleNFe(base44, topic, evt) {
  const codigoPedido = String(
    evt?.idPedido || evt?.id_pedido || evt?.codigo_pedido || evt?.nCodPed || ''
  );
  if (!codigoPedido) return { acao: 'ignorado', motivo: 'sem codigo_pedido' };

  // 🔄 ESPELHO OPERAÇÃO: atualizar status NF do pedido (etapa 60)
  // Quando o webhook traz numero_nf, repassamos para forçar atualização direta — evita o caso em que
  // o dedupe pula o webhook NFe (chega logo após VendaProduto.Faturada) e o número da NF se perde.
  // ⚠️ REJEIÇÃO/DENEGAÇÃO: usa forceRejeicao para BYPASSAR o dedupe (senão o espelho fica como "Faturado"
  // porque VendaProduto.Faturada acabou de sincronizar e o ConsultarPedido ainda não traz o cStat>=200).
  try {
    const numNfWebhook = evt?.numero_nf || evt?.numero_nota || null;
    const xMotivo = evt?.xMotivo || evt?.cMensStatus || evt?.motivo || '';
    const cStat = evt?.cStat || '';

    if (topic === 'NFe.NotaRejeitada') {
      await upsertEspelho(base44, codigoPedido, null, {
        status_real: 'rejeitada',
        status_label: `NF Rejeitada${cStat ? ` [${cStat}]` : ''}${xMotivo ? ` — ${xMotivo}` : ''}`.slice(0, 200)
      });
    } else if (topic === 'NFe.NotaDenegada') {
      await upsertEspelho(base44, codigoPedido, null, {
        status_real: 'denegada',
        status_label: `NF Denegada${cStat ? ` [${cStat}]` : ''}${xMotivo ? ` — ${xMotivo}` : ''}`.slice(0, 200)
      });
    } else if (topic === 'NFe.NotaCancelada') {
      await upsertEspelho(base44, codigoPedido, null, {
        status_real: 'cancelada',
        status_label: 'NF Cancelada'
      });
    } else if (topic === 'NFe.NotaAutorizada' || topic === 'NFe.NotaDevolucaoAutorizada') {
      // Todos os dados da NF já vêm no payload — atualiza espelho SEM ConsultarPedido (evita 105/6).
      await aplicarNfNoEspelhoSemConsulta(base44, codigoPedido, numNfWebhook);
    }
  } catch (e) {
    console.error(`[espelhoOperacao NFe] erro ao sincronizar ${codigoPedido}:`, e.message);
  }

  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
  if (pedidos.length === 0) return { acao: 'ignorado', motivo: 'NF sem pedido local — processada só com dados do payload', sem_pedido_local: true };

  const pedido = pedidos[0];
  const updates = {};
  const dadosCarga = {};

  if (topic === 'NFe.NotaAutorizada') {
    updates.faturado = true;
    updates.status = 'faturado';
    updates.data_faturamento = new Date().toISOString();
    const numNf = evt?.numero_nf || evt?.numero_nota;
    if (numNf) {
      updates.numero_nota_fiscal = String(numNf);
      updates.status_faturamento = 'faturado';
      dadosCarga.numero_nf = String(numNf);
    }
    dadosCarga.etapa = '60';
    dadosCarga.status_pedido = 'faturado';

    // Atualizar LogEmissaoNF pendente → autorizada (se existir)
    try {
      const logsPendentes = await base44.asServiceRole.entities.LogEmissaoNF.filter(
        { codigo_pedido: codigoPedido, status: 'pendente' }, '-created_date', 5
      ).catch(() => []);
      for (const log of logsPendentes) {
        await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, {
          status: 'autorizada',
          numero_nf: numNf ? String(numNf) : log.numero_nf || '',
          codigo_sefaz: '100',
          mensagem: 'NF emitida (etapa 60 confirmada no Omie)',
          boleto_gerado: false
        }).catch(() => {});
      }
    } catch (e) {
      console.error(`[handleNFe] erro ao atualizar LogEmissaoNF pendente:`, e.message);
    }
  } else if (topic === 'NFe.NotaCancelada') {
    // NF cancelada = pedido tinha NF emitida → pós-faturamento. Preserva rastreabilidade.
    const { updates: u } = montarUpdatesCancelamento(pedido, 'NF-e cancelada no Omie');
    Object.assign(updates, u);
    updates.status = 'cancelado_pos_faturamento';
    dadosCarga.etapa = '80';
    dadosCarga.status_pedido = 'cancelado_pos_faturamento';
  } else if (topic === 'NFe.NotaDevolucaoAutorizada') {
    updates.motivo_cancelamento = 'NF-e de devolução autorizada no Omie';
    const numNf = evt?.numero_nf || evt?.numero_nota;
    if (numNf) updates.numero_nota_fiscal = String(numNf);
    dadosCarga.status_pedido = 'devolvido';
  } else if (topic === 'NFe.NotaRejeitada' || topic === 'NFe.NotaDenegada') {
    // NF rejeitada/denegada: pedido FICA em etapa 60 no Omie (Faturado com rejeição).
    // Não cancelamos o Pedido local — apenas marcamos para o operador agir (corrigir e reemitir).
    updates.faturado = false;
    updates.status_faturamento = topic === 'NFe.NotaDenegada' ? 'erro' : 'rejeitado';
    const motivo = topic === 'NFe.NotaDenegada' ? 'NF-e DENEGADA pela SEFAZ' : 'NF-e REJEITADA pela SEFAZ';
    const detalhe = evt?.xMotivo || evt?.cMensStatus || evt?.motivo || '';
    updates.omie_erro = `${motivo}${detalhe ? ' — ' + detalhe : ''}`.slice(0, 500);
    dadosCarga.etapa = '60';
    dadosCarga.status_pedido = topic === 'NFe.NotaDenegada' ? 'nf_denegada' : 'nf_rejeitada';
    dadosCarga.motivo_rejeicao = updates.omie_erro;

    // Atualizar LogEmissaoNF pendente → rejeitada (se existir)
    try {
      const logsPendentes = await base44.asServiceRole.entities.LogEmissaoNF.filter(
        { codigo_pedido: codigoPedido, status: 'pendente' }, '-created_date', 5
      ).catch(() => []);
      const statusLog = topic === 'NFe.NotaDenegada' ? 'rejeitada' : 'rejeitada';
      for (const log of logsPendentes) {
        await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, {
          status: statusLog,
          mensagem: updates.omie_erro,
          faultstring: detalhe || '',
          codigo_sefaz: evt?.cStat || ''
        }).catch(() => {});
      }
    } catch (e) {
      console.error(`[handleNFe] erro ao atualizar LogEmissaoNF rejeitada:`, e.message);
    }
  }

  if (Object.keys(updates).length > 0) {
    await base44.asServiceRole.entities.Pedido.update(pedido.id, updates);
  }
  if (Object.keys(dadosCarga).length > 0) {
    await atualizarPedidoNaCarga(base44, codigoPedido, dadosCarga);
  }

  return { acao: 'atualizado', pedido_id: pedido.id, updates };
}

async function handleFinanceiro(base44, topic, evt) {
  // Eventos financeiros: só loga (acerto de caixa tem fluxo próprio)
  return {
    acao: 'logado',
    topic,
    codigo_lancamento: evt?.codigo_lancamento || null,
    valor: evt?.valor_pago || evt?.valor || null
  };
}

// === HANDLER PRINCIPAL (entity automation payload) ===

Deno.serve(async (req) => {
  // 🐛 FIX: payload e entityId declarados fora do try para uso no catch
  // (req.json() só pode ser chamado UMA vez — stream é consumido)
  let payload = {};
  let entityId = null;
  try {
    const base44 = createClientFromRequest(req);
    payload = await req.json().catch(() => ({}));

    // Entity automation envia: { event: {type, entity_name, entity_id}, data: {...} }
    const eventType = payload?.event?.type;
    const entityName = payload?.event?.entity_name;
    entityId = payload?.event?.entity_id;
    let logData = payload?.data;

    // Só processa criação de LogIntegracaoOmie
    if (eventType !== 'create' || entityName !== 'LogIntegracaoOmie') {
      return Response.json({ ignorado: true, motivo: 'evento não aplicável' });
    }

    // Se payload veio truncado, busca o log
    if (payload?.payload_too_large || !logData) {
      logData = await base44.asServiceRole.entities.LogIntegracaoOmie.get(entityId);
    }

    // Só processa logs de webhook pendentes
    if (logData?.endpoint !== 'webhook' || logData?.status !== 'pendente') {
      return Response.json({ ignorado: true, motivo: 'log não é webhook pendente' });
    }

    // CIRCUIT BREAKER: se API bloqueada, marca como rate-limited e sai sem chamar Omie.
    // A reconciliação periódica recupera esses dados depois.
    const cbCheck = await checkCircuitBreaker(base44);
    const topic0 = logData.webhook_topic || logData.call || '';
    const topicsQueChamam = ['VendaProduto.Faturada', 'VendaProduto.EtapaAlterada', 'VendaProduto.Incluida', 'VendaProduto.Alterada', 'VendaProduto.Excluida', 'VendaProduto.Cancelada'];
    if (cbCheck.blocked && topicsQueChamam.includes(topic0)) {
      // RESILIÊNCIA: NUNCA descartar o webhook. Mantém 'pendente' para o worker
      // processarFilaWebhookOmie reprocessar quando o circuit breaker liberar.
      // (Antes virava 'erro' e o evento se perdia — causa de pedidos presos.)
      await base44.asServiceRole.entities.LogIntegracaoOmie.update(entityId, {
        status: 'pendente',
        mensagem_erro: 'Aguardando liberação do rate limit (reenfileirado)',
        webhook_processado_em: null
      }).catch((e) => { console.error('[processarWebhookOmie] falha ao reenfileirar webhook (circuit breaker):', e?.message || e); });
      return Response.json({ sucesso: false, motivo: 'circuit_breaker_ativo_reenfileirado', bloqueado_ate: cbCheck.blockedUntil });
    }

    const topic = logData.webhook_topic || logData.call || '';
    let body;
    try { body = JSON.parse(logData.payload_resposta || '{}'); } catch { body = {}; }
    const evt = body.event || body;

    const topicsSilenciosos = [
      'RecebimentoProduto.Incluido',
      'Produto.MovimentacaoEstoque'
    ];

    if (topicsSilenciosos.includes(topic)) {
      await base44.asServiceRole.entities.LogIntegracaoOmie.update(entityId, {
        status: 'ignorado',
        call: topic,
        operacao: 'receber_webhook',
        mensagem_erro: null,
        payload_resposta: JSON.stringify(body).slice(0, 3000),
        payload_enviado: JSON.stringify({ acao: 'ignorado', motivo: 'topic silencioso' }).slice(0, 3000),
        webhook_processado_em: new Date().toISOString()
      });

      return Response.json({ sucesso: true, topic, resultado: { acao: 'ignorado', silencioso: true } }, { status: 200 });
    }

    let resultado = { acao: 'ignorado' };

    // ROTEAMENTO
    if (topic.startsWith('VendaProduto.')) {
      resultado = await handlePedido(base44, topic, evt);
    } else if (topic.startsWith('NFe.')) {
      resultado = await handleNFe(base44, topic, evt);
    } else if (topic.startsWith('Financas.ContaReceber.')) {
      resultado = await handleFinanceiro(base44, topic, evt);
    } else if (topic.startsWith('ClienteFornecedor.')) {
      // Decisão do usuário: SÓ LOGAR, sem atualizar
      resultado = {
        acao: 'logado',
        motivo: 'Cliente alterado no Omie — sem sincronização automática',
        codigo_omie: evt?.codigo_cliente_omie || evt?.idCliente || null
      };
    } else if (topic.startsWith('Produto.')) {
      // Decisão do usuário: SÓ LOGAR, sem atualizar
      resultado = {
        acao: 'logado',
        motivo: 'Produto alterado no Omie — sem sincronização automática',
        codigo_omie: evt?.codigo_produto || evt?.idProduto || null
      };
    }

    // Marca log como processado
    // ⚠️ mensagem_erro SÓ deve ser preenchida em casos de erro real —
    // nunca em sucessos/skips (causaria falso positivo vermelho na UI).
    const statusFinal = resultado.acao === 'ignorado' ? 'ignorado' : 'processado';
    const mensagemErroFinal = statusFinal === 'ignorado' ? (resultado.motivo || null) : null;
    await base44.asServiceRole.entities.LogIntegracaoOmie.update(entityId, {
      status: statusFinal,
      webhook_processado_em: new Date().toISOString(),
      mensagem_erro: mensagemErroFinal,
      payload_enviado: JSON.stringify(resultado).slice(0, 3000)
    });

    return Response.json({ sucesso: true, topic, resultado });
  } catch (error) {
    console.error('[processarWebhookOmie] Erro:', error.message);

    // 🐛 FIX: usa payload e entityId já extraídos no início (sem chamar req.json() de novo)
    try {
      const base44 = createClientFromRequest(req);
      if (entityId) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.update(entityId, {
          status: 'erro',
          mensagem_erro: error.message.slice(0, 500),
          webhook_processado_em: new Date().toISOString()
        });
      }
    } catch (catchErr) {
      console.error('[processarWebhookOmie] Falha ao marcar log como erro:', catchErr.message);
    }

    return Response.json({ error: error.message }, { status: 500 });
  }
});