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
// 🔄 PROCESSADOR ASSÍNCRONO DE WEBHOOK
// Disparado pela entity automation quando LogIntegracaoOmie é criado com status='pendente'.
// Roteia o evento para o handler correto e atualiza o log.

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
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controleCb = cb?.[0];
  if (controleCb?.bloqueado && controleCb.bloqueado_ate && new Date(controleCb.bloqueado_ate) > new Date()) {
    console.log(`[espelho] API Omie bloqueada (425) — pulando ConsultarPedido de ${omieCodigoPedido} até ${controleCb.bloqueado_ate}`);
    return;
  }

  const consultar = async (tentativa = 1) => {
    const data = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(omieCodigoPedido) }, { call: 'ConsultarPedido', maxTentativas: 2 });
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      // 425 / consumo indevido → abre circuit breaker (bloqueio 30min) e aborta
      if (msg.includes('consumo indevido') || msg.includes('bloquead') || msg.includes('bloqueio') || msg.includes('425')) {
        const bloqueadoAte = new Date(Date.now() + 30 * 60000).toISOString();
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: bloqueadoAte, ultimo_erro: data.faultstring || 'HTTP 425 consumo indevido', atualizado_em: new Date().toISOString() };
        if (controleCb?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controleCb.id, payloadCb).catch(() => {});
        else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
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
  if (!pedidoBruto?.cabecalho) return;
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

  const existentes = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) });
  if (existentes.length > 0) {
    await base44.asServiceRole.entities.PedidoLiberadoOmie.update(existentes[0].id, registro);
  } else {
    await base44.asServiceRole.entities.PedidoLiberadoOmie.create(registro);
  }
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
      // ⚠️ BONIFICAÇÃO: o Omie marca como "cancelado" após emitir NF.
      // NÃO remover espelho nem cancelar pedido se tiver NF autorizada.
      // A verificação de NF é feita no handler principal abaixo.
      // Por ora, NÃO removemos do espelho — o handler decide.
      espelhoAcao = 'cancelada_verificar_nf';
    } else if (
      topic === 'VendaProduto.Faturada' ||
      topic === 'VendaProduto.EtapaAlterada' ||
      topic === 'VendaProduto.Incluida' ||
      topic === 'VendaProduto.Alterada'
  } catch (e) {
    console.error(`[espelhoOperacao] erro ao sincronizar ${codigoPedido}:`, e.message);
  }

  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
  if (pedidos.length === 0) return { acao: 'ignorado', motivo: 'pedido não encontrado no Base44', espelho: espelhoAcao };

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
  } else if (topic === 'VendaProduto.Excluida') {
    // ⚠️ BUG FIX: Antes de cancelar, verificar se existe NF autorizada.
    // O Omie pode marcar como "excluído" após encerramento de fluxo, mas a NF continua válida.
    let nfAutorizadaExcluida = false;
    let numeroNfExcluida = null;
    try {
      const nfData = await omieCall(base44, 'produtos/pedidovendafat/', { nIdPedido: Number(codigoPedido) }, { call: 'ConsultarNF', maxTentativas: 2 });
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
      updates.status = 'cancelado';
      updates.data_cancelamento = new Date().toISOString();
      updates.motivo_cancelamento = `Excluído no Omie (${topic})`;
      dadosCarga.etapa = 'excluido';
      dadosCarga.status_pedido = 'cancelado';
    }
  } else if (topic === 'VendaProduto.Cancelada') {
    // Verificar se existe NF autorizada antes de cancelar (qualquer tipo de pedido).
    let nfAutorizada = false;
    let numeroNfBonif = null;

    // ⚠️ BUG FIX: Verificar NF para TODOS os pedidos (não só bonificações).
    // O Omie marca pedidos como "cancelado" após encerrar fluxo, mas a NF pode estar válida.
    console.log(`[webhook] Pedido ${pedido.numero_pedido} (tipo=${pedido.tipo}) — VendaProduto.Cancelada — verificando NF antes de cancelar...`);
    try {
      const nfData = await omieCall(base44, 'produtos/pedidovendafat/', { nIdPedido: Number(codigoPedido) }, { call: 'ConsultarNF', maxTentativas: 2 });
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
      // Cancelamento real
      updates.status = 'cancelado';
      updates.data_cancelamento = new Date().toISOString();
      updates.motivo_cancelamento = `Cancelado no Omie (${topic})`;
      dadosCarga.etapa = '80';
      dadosCarga.status_pedido = 'cancelado';
      // Remover do espelho
      try { await removerDoEspelho(base44, codigoPedido); } catch {}
    }
  } else if (topic === 'VendaProduto.EtapaAlterada') {
    const novoStatus = mapEtapaParaStatus(evt?.etapa);
    if (novoStatus) updates.status = novoStatus;
    if (String(evt?.etapa || '') === '60') {
      updates.faturado = true;
      updates.status_faturamento = 'faturado';
      updates.data_faturamento = updates.data_faturamento || new Date().toISOString();
      if (evt?.numero_nf || evt?.numero_nota) {
        updates.numero_nota_fiscal = String(evt.numero_nf || evt.numero_nota);
        dadosCarga.numero_nf = updates.numero_nota_fiscal;
      }
    }
    if (evt?.etapa) dadosCarga.etapa = String(evt.etapa);
  } else if (topic === 'VendaProduto.Devolvida') {
    updates.status = 'cancelado';
    updates.data_cancelamento = new Date().toISOString();
    updates.motivo_cancelamento = 'Pedido devolvido no Omie';
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
  if (!codigoPedido) return;
  try {
    await base44.functions.invoke('gerarBoletosOmie', {
      origem: 'auto',
      pedidos: [{ codigo_pedido: String(codigoPedido) }]
    });
  } catch (e) {
    console.error(`[gerarBoletoAuto] erro pedido ${codigoPedido}:`, e.message);
  }
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
      await upsertEspelho(base44, codigoPedido, numNfWebhook);
    }
  } catch (e) {
    console.error(`[espelhoOperacao NFe] erro ao sincronizar ${codigoPedido}:`, e.message);
  }

  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
  if (pedidos.length === 0) return { acao: 'ignorado', motivo: 'pedido não encontrado' };

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
    // 🚫 Geração AUTOMÁTICA de boleto foi DESATIVADA.
    // O operador gera os boletos manualmente em "Logística → Emissão de Boletos".
  } else if (topic === 'NFe.NotaCancelada') {
    updates.status = 'cancelado';
    updates.data_cancelamento = new Date().toISOString();
    updates.motivo_cancelamento = 'NF-e cancelada no Omie';
    dadosCarga.etapa = '80';
    dadosCarga.status_pedido = 'cancelado';
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
    await base44.asServiceRole.entities.LogIntegracaoOmie.update(entityId, {
      status: resultado.acao === 'ignorado' ? 'ignorado' : 'processado',
      webhook_processado_em: new Date().toISOString(),
      mensagem_erro: resultado.motivo || null,
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