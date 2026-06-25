import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MAX_TENTATIVAS = 3;
const MAX_TENTATIVAS_LEITURA = 5;       // teto de retries por falha transitória de leitura do Pedido (antes de virar erro)
const INTERVALO_ENTRE_PEDIDOS_MS = 450; // ~2 req/s — margem segura abaixo do limite Omie (4 req/s)
const MAX_PEDIDOS_POR_RODADA = 30;      // tamanho de cada busca interna de pendentes
const TETO_EXECUCAO_MS = 150000;        // 150s — abaixo do timeout (180s); drena a fila numa execução
const CHAVE_WORKER_ENVIO = 'worker_envio_pedido'; // chave dedicada do lock de auto-encadeamento (não colide com worker de webhooks)
const LOCK_TTL_MS = 2 * 60 * 1000;      // TTL curto do lock — auto-release se a função morrer

// ============================================================
// LOCK DE AUTO-ENCADEAMENTO — garante 1 cadeia por vez.
// Usa um registro dedicado (chave='worker_envio_pedido') com worker_rodando +
// worker_lock_ate. TTL curto evita travamento permanente se a função morrer.
// ============================================================
async function adquirirLockEncadeamento(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ chave: CHAVE_WORKER_ENVIO }, '-updated_date', 1).catch(() => []);
  const reg = rows?.[0];
  const agora = Date.now();
  const lockAtivo = reg?.worker_rodando && reg?.worker_lock_ate && new Date(reg.worker_lock_ate).getTime() > agora;
  if (lockAtivo) return { adquirido: false };
  const dados = {
    chave: CHAVE_WORKER_ENVIO,
    worker_rodando: true,
    worker_lock_ate: new Date(agora + LOCK_TTL_MS).toISOString(),
    atualizado_em: new Date().toISOString()
  };
  if (reg) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(reg.id, dados).catch(() => {});
  else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(dados).catch(() => {});
  return { adquirido: true, id: reg?.id };
}

async function liberarLockEncadeamento(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ chave: CHAVE_WORKER_ENVIO }, '-updated_date', 1).catch(() => []);
  const reg = rows?.[0];
  if (reg) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(reg.id, {
    worker_rodando: false, worker_lock_ate: null, atualizado_em: new Date().toISOString()
  }).catch(() => {});
}

// ============================================================
// LEITURA SEGURA DO PEDIDO — distingue "não existe" de "falha ao ler".
// Retorna { pedido } se achou, { naoExiste:true } se comprovadamente inexistente
// (404 confirmado por 2ª leitura), { transitorio:true } se falha de rede/429/timeout.
// NUNCA confunde "não consegui ler agora" com "foi excluído".
// ============================================================
async function lerPedidoSeguro(base44, pedido_id) {
  try {
    const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
    if (pedido) return { pedido };
    // get retornou null/undefined sem throw — tratar como possível inexistência, confirmar
  } catch (e) {
    const msg = String(e?.message || e);
    const naoExiste = e?.status === 404 || /not found|não encontrad|nao encontrad|does not exist/i.test(msg);
    if (!naoExiste) {
      // Erro TRANSITÓRIO (429/timeout/rede) → não descartar
      return { transitorio: true, erro: msg };
    }
  }
  // Chegou aqui = 1ª leitura indicou inexistência. CONFIRMAR com 2ª leitura (via filter) antes de descartar.
  await new Promise(r => setTimeout(r, 300));
  try {
    const conf = await base44.asServiceRole.entities.Pedido.filter({ id: pedido_id });
    if (conf && conf.length) return { pedido: conf[0] };
    return { naoExiste: true };
  } catch (e2) {
    // 2ª leitura também falhou, mas com erro (não confirmou inexistência) → tratar como transitório
    return { transitorio: true, erro: String(e2?.message || e2) };
  }
}

const OMIE_BASE_URL = "https://app.omie.com.br/api/v1/";
const CONTA_CORRENTE_PADRAO = 11464371392;
const DEFAULT_TIMEOUT_MS = 15000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

// ============================================================
// CREDENCIAIS OMIE
// ============================================================
let _credsCache = null;
async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  if (ativo?.app_key && ativo?.app_secret) {
    _credsCache = { appKey: String(ativo.app_key), appSecret: String(ativo.app_secret), at: Date.now() };
    return _credsCache;
  }
  _credsCache = { appKey: Deno.env.get('OMIE_APP_KEY') || '', appSecret: Deno.env.get('OMIE_APP_SECRET') || '', at: Date.now() };
  return _credsCache;
}

// ============================================================
// CIRCUIT BREAKER
// ============================================================
async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const control = rows?.[0];
  if (!control?.bloqueado) return { blocked: false };
  const blockedUntil = control.bloqueado_ate ? new Date(control.bloqueado_ate).getTime() : 0;
  if (blockedUntil && blockedUntil <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(control.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => {});
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: control.bloqueado_ate, lastError: control.ultimo_erro };
}

async function setCircuitBreakerBlocked(base44, errorMessage) {
  const CB_FIXED_ID = '6a1e06a9aa62ceab7b3b6d97';
  const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_FIXED_ID }, '-created_date', 1).catch(() => []);
  const _cb = _cbRows?.[0];
  const _erros = (_cb?.erros_consecutivos || 0) + 1;
  const _thresh = _cb?.threshold_erros ?? 3;
  const _p: any = { erros_consecutivos: _erros, ultimo_erro: errorMessage.slice(0, 500), atualizado_em: new Date().toISOString() };
  // Extrair tempo real que o Omie informou; se não informou, NÃO bloqueia
  const secsMatch = errorMessage.match(/(\d+)\s*segundo/i);
  const secs = secsMatch ? Math.min(Number(secsMatch[1]), 1800) : 0;
  if (_erros >= _thresh && secs > 0) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + secs * 1000).toISOString(); }
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_FIXED_ID, _p).catch(() => {});
}

// ============================================================
// OMIE CALL INLINE
// ============================================================
async function omieCallDirect(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  
  const breaker = await checkCircuitBreaker(base44);
  if (breaker.blocked) throw new Error(`API Omie bloqueada até ${breaker.blockedUntil || '?'}. Erro: ${breaker.lastError || 'n/a'}`);

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const body = { call, app_key: appKey, app_secret: appSecret, param: Array.isArray(param) ? param : [param] };
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timer);
      if (response.status === 429) {
        lastError = new Error('Rate limit Omie (HTTP 429).');
        if (attempt < RETRY_DELAYS_MS.length) { await sleep(RETRY_DELAYS_MS[attempt]); continue; }
        await setCircuitBreakerBlocked(base44, lastError.message);
        throw lastError;
      }
      const text = await response.text();
      let data = text ? JSON.parse(text) : {};
      // Omie às vezes retorna o erro como ARRAY [{CODIGO, MENSAGEM, ORIGEM}] com HTTP 200 — normalizar para faultstring
      if (Array.isArray(data) && data[0] && (data[0].MENSAGEM || data[0].CODIGO !== undefined)) {
        const e0 = data[0];
        data = { faultstring: String(e0.MENSAGEM || `Omie CODIGO ${e0.CODIGO}`), faultcode: String(e0.CODIGO ?? '') };
      }
      if (!response.ok || data?.faultstring || data?.faultcode) {
        const msg = data?.faultstring || `Erro HTTP ${response.status}`;
        const lower = msg.toLowerCase();
        const faultLower = String(data?.faultcode || '').toLowerCase();
        if (faultLower.includes('misuse') || lower.includes('consumo indevido') || lower.includes('misuse')) {
          await setCircuitBreakerBlocked(base44, `MISUSE: ${msg}`);
        } else if (lower.includes('cota') || lower.includes('limite') || lower.includes('bloque') || lower.includes('suspended') || response.status === 403 || response.status === 425) {
          await setCircuitBreakerBlocked(base44, msg);
        }
        // Retornar faultstring para lógica de tratamento existente
        return data;
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (error) {
      clearTimeout(timer);
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === 'AbortError') lastError = new Error(`Timeout de ${timeoutMs}ms.`);
      if (attempt < RETRY_DELAYS_MS.length && lastError.message.includes('429')) continue;
      break;
    }
  }
  throw lastError || new Error('Erro desconhecido na API Omie.');
}

// ============================================================
// HELPERS
// ============================================================
function debugLog(base44, mensagem, extra = {}) {
  console.log(mensagem);
  base44.asServiceRole.entities.LogIntegracaoOmie.create({
    endpoint: 'processarFila:debug', call: 'processarFila:debug', operacao: 'processarFila',
    status: extra.erro ? 'erro' : 'sucesso',
    payload_enviado: JSON.stringify(extra).slice(0, 2000),
    payload_resposta: mensagem.slice(0, 2000)
  }).catch(() => {});
}

async function omieCall(base44, ...args) {
  const [callOrEndpoint, param, opts] = args;
  if (opts !== undefined || (typeof callOrEndpoint === 'string' && callOrEndpoint.includes('/'))) {
    return omieCallDirect(base44, callOrEndpoint, param, opts || {});
  }
  return omieCallDirect(base44, 'produtos/pedido/', param, { call: callOrEndpoint });
}

let _contaCorrenteCache = null;
async function resolverContaCorrentePadrao(base44) {
  if (_contaCorrenteCache) return _contaCorrenteCache;
  try {
    const cc = await omieCall(base44, "ListarContasCorrentes", { pagina: 1, registros_por_pagina: 50 }, { maxTentativas: 2 });
    const lista = cc?.ListarContasCorrentes || cc?.conta_corrente_lista || [];
    if (lista.length > 0) {
      const padrao = lista.find(c => c.cPadrao === "S" || c.padrao === "S") || lista[0];
      _contaCorrenteCache = padrao.nCodCC || padrao.codigo || CONTA_CORRENTE_PADRAO;
      return _contaCorrenteCache;
    }
  } catch { /* ignore */ }
  _contaCorrenteCache = CONTA_CORRENTE_PADRAO;
  return _contaCorrenteCache;
}

function formatDateOmie(dateStr) {
  if (!dateStr) return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
  const s = String(dateStr).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.split('T')[0].split('-');
    return `${d}/${m}/${y}`;
  }
  return s;
}

function gerarParcelas(plano, valorTotal) {
  const numParcelas = plano?.numero_parcelas || 1;
  const diasPrimeira = plano?.dias_primeira_parcela || 30;
  const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;
  const parcelas = [];
  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
  const [yy, mm, dd] = hojeStr.split('-').map(Number);
  for (let i = 0; i < numParcelas; i++) {
    const diasOffset = diasPrimeira + (i * 30);
    const dataVenc = new Date(Date.UTC(yy, mm - 1, dd));
    dataVenc.setUTCDate(dataVenc.getUTCDate() + diasOffset);
    const d = String(dataVenc.getUTCDate()).padStart(2, '0');
    const m = String(dataVenc.getUTCMonth() + 1).padStart(2, '0');
    const y = dataVenc.getUTCFullYear();
    let valor = valorParcela;
    if (i === numParcelas - 1) {
      const totalAnterior = parcelas.reduce((s, p) => s + p.valor, 0);
      valor = Math.round((valorTotal - totalAnterior) * 100) / 100;
    }
    parcelas.push({ numero_parcela: i + 1, data_vencimento: `${d}/${m}/${y}`, percentual: Math.round((100 / numParcelas) * 100) / 100, valor });
  }
  return parcelas;
}

async function resolverClienteOmie(base44, pedido, clienteBase44) {
  // 1. PREFERENCIAL: cliente tem codigo_omie → usa codigo_cliente (entra de 1ª, sem erro 1050).
  if (clienteBase44?.codigo_omie) {
    return { ok: true, payload: { codigo_cliente: Number(clienteBase44.codigo_omie) }, fonte: 'local_codigo_omie' };
  }
  // 2. Sem codigo_omie → usa SEMPRE o id Base44 (código de integração REAL no Omie).
  //    NUNCA pedido.cliente_codigo (codigo_interno, ex: 28948) — gera erro 1050.
  const codIntegracao = clienteBase44?.id || pedido.cliente_id;
  if (codIntegracao) {
    return { ok: true, payload: { codigo_cliente_integracao: String(codIntegracao) }, fonte: 'local_codigo_integracao', precisaValidar: !clienteBase44?.codigo_omie };
  }
  return { ok: false, erro: 'Cliente sem identificação para o Omie' };
}

async function exportarClienteSeNecessario(base44, clienteBase44) {
  if (!clienteBase44) return { ok: false, erro: 'Cliente Base44 inexistente' };
  if (clienteBase44.tipo_nota === 'D1') return { ok: false, erro: 'Cliente marcado como D1' };
  const r = await base44.asServiceRole.functions.invoke('enviarClienteOmie', {
    event: { type: 'auto_pedido', entity_id: clienteBase44.id },
    data: clienteBase44
  });
  const d = r?.data || r;
  if (!d?.sucesso) return { ok: false, erro: d?.erro || 'Falha exportando cliente' };
  return { ok: true, codigo_omie: d.codigo_omie };
}

function montarPayloadPedido({ pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente }) {
  const dataPrevisao = formatDateOmie(pedido.data_previsao_entrega);
  const det = items.map((item) => {
    const prod = produtosMap[item.produto_id] || {};
    const unidade = prod.unidade_medida_id ? unidadesMap[prod.unidade_medida_id] : null;
    const unidadeStr = unidade?.nome || 'UN';
    const infAdic = { peso_bruto: (prod.peso || 0) * item.quantidade, peso_liquido: (prod.peso || 0) * item.quantidade };
    if (pedido.numero_pedido_compra) {
      infAdic.numero_pedido_compra = pedido.numero_pedido_compra;
      infAdic.dados_adicionais_item = `Pedido de Compra: ${pedido.numero_pedido_compra}`;
    }
    const produtoRef = prod.codigo_omie ? { codigo_produto: Number(prod.codigo_omie) } : { codigo_produto_integracao: item.produto_id };
    return {
      ide: { codigo_item_integracao: item.id },
      inf_adic: infAdic,
      produto: { ...produtoRef, descricao: item.produto_nome || prod.nome || '', ncm: prod.ncm || '', quantidade: item.quantidade, valor_unitario: item.valor_unitario, tipo_desconto: "V", valor_desconto: 0, unidade: unidadeStr }
    };
  });
  const parcelas = gerarParcelas(plano, pedido.valor_total || 0);
  const identificacaoCliente = [
    pedido.cliente_nome_fantasia || pedido.cliente_nome || '',
    pedido.cliente_codigo || ''
  ].filter(Boolean).join(' - ');
  const dadosAdicNfOriginal = pedido.dados_adicionais_nf || '';
  const jaTemIdentificacao = identificacaoCliente && dadosAdicNfOriginal.startsWith(identificacaoCliente);
  const dadosAdicNf = identificacaoCliente
    ? (jaTemIdentificacao ? dadosAdicNfOriginal : [identificacaoCliente, dadosAdicNfOriginal].filter(Boolean).join(' | '))
    : dadosAdicNfOriginal;
  const cabecalho = { codigo_pedido_integracao: pedido.id, ...clientePayload, data_previsao: dataPrevisao, etapa: "10", codigo_parcela: "999", quantidade_itens: items.length };
  if (pedido.cenario_fiscal_codigo && !isNaN(Number(pedido.cenario_fiscal_codigo)) && Number(pedido.cenario_fiscal_codigo) > 0) {
    cabecalho.codigo_cenario_impostos = String(pedido.cenario_fiscal_codigo);
  }
  const payload = {
    cabecalho, det, frete: { modalidade: "9" },
    informacoes_adicionais: {
      codigo_categoria: "1.01.01", consumidor_final: "S", enviar_email: "N", codigo_conta_corrente: contaCorrente,
      ...(pedido.numero_pedido_compra ? { numero_pedido_cliente: pedido.numero_pedido_compra } : {}),
      ...(dadosAdicNf ? { dados_adicionais_nf: dadosAdicNf } : {})
    }
  };
  if (parcelas.length > 0) payload.lista_parcelas = { parcela: parcelas };
  return payload;
}

// ============================================================
// CORE: envia 1 pedido (autocontido, sem functions.invoke)
// ============================================================
async function enviarUmPedido(base44, pedido_id, ctx = {}) {
  const t0 = Date.now();
  let pedido = ctx.pedido || null;
  if (!pedido) {
    const leitura = await lerPedidoSeguro(base44, pedido_id);
    if (leitura.transitorio) return { sucesso: false, erro: 'Falha transitória ao ler pedido (retry)', pedido_id, transitorio: true };
    if (leitura.naoExiste) return { sucesso: false, erro: 'Pedido não encontrado', pedido_id, terminal: true };
    pedido = leitura.pedido;
  }

  debugLog(base44, `[fila] Iniciando envio pedido ${pedido_id}, modelo=${pedido.modelo_nota}, tipo=${pedido.tipo}`, { pedido_id });

  if (!['pendente', 'enviado', 'liberado'].includes(pedido.status)) return { sucesso: false, erro: 'Status inválido para envio', pedido_id };
  if (pedido.omie_enviado && pedido.omie_codigo_pedido) return { sucesso: true, pedido_id, codigo_pedido_omie: pedido.omie_codigo_pedido, numero_pedido_omie: pedido.numero_pedido, mensagem: 'Já enviado' };
  if (!pedido.data_previsao_entrega) return { sucesso: false, erro: 'Data de Previsão obrigatória', pedido_id };
  if (pedido.tipo === 'troca') return { sucesso: true, pedido_id, codigo_pedido_omie: null, mensagem: 'Troca não gera venda no Omie' };
  if (pedido.modelo_nota === 'd1') return { sucesso: false, erro: 'Pedido D1 não enviado ao Omie', pedido_id };

  const items = ctx.items || ctx.itemsPorPedido?.[pedido_id] || await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });
  if (items.length === 0) return { sucesso: false, erro: 'Pedido sem itens', pedido_id };

  let clienteBase44 = ctx.cliente || ctx.clientesPorId?.[pedido.cliente_id] || null;
  if (!clienteBase44 && pedido.cliente_id) clienteBase44 = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id).catch(() => null);

  if (clienteBase44?.tipo_nota === 'D1') {
    await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: 'Cliente D1 — não enviado', omie_enviado: false });
    return { sucesso: false, erro: 'Cliente D1 — não enviado ao Omie', pedido_id };
  }

  let plano = ctx.plano || ctx.planosPorId?.[pedido.plano_pagamento_id] || null;
  if (!plano && pedido.plano_pagamento_id) plano = await base44.asServiceRole.entities.PlanoPagamento.get(pedido.plano_pagamento_id).catch(() => null);

  const produtosMap = ctx.produtosMap || {};
  if (!ctx.produtosMap) {
    const pids = [...new Set(items.map(i => i.produto_id))];
    const prods = await Promise.all(pids.map(pid => base44.asServiceRole.entities.Produto.get(pid).catch(() => null)));
    prods.forEach(p => { if (p) produtosMap[p.id] = p; });
  }

  const unidadesMap = ctx.unidadesMap || {};
  if (!ctx.unidadesMap) {
    const uns = await base44.asServiceRole.entities.UnidadeMedida.list().catch(() => []);
    uns.forEach(u => { unidadesMap[u.id] = u; });
  }

  let res = await resolverClienteOmie(base44, pedido, clienteBase44);
  if (!res.ok) return { sucesso: false, erro: res.erro, pedido_id };
  let clientePayload = res.payload;

  const contaCorrente = ctx.contaCorrentePadrao || await resolverContaCorrentePadrao(base44);
  const payload = montarPayloadPedido({ pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente });
  let resultado = await omieCall(base44, "IncluirPedido", payload);

  // Cliente não existe → exportar e retry
  if (resultado?.faultstring && /cliente.*(não.*(localizado|encontrado|cadastrado)|invalid)/i.test(resultado.faultstring) && clienteBase44) {
    const exp = await exportarClienteSeNecessario(base44, clienteBase44);
    if (exp.ok) {
      await sleep(1500);
      clientePayload = { codigo_cliente_integracao: String(clienteBase44.id) };
      resultado = await omieCall(base44, "IncluirPedido", montarPayloadPedido({ pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente }));
    } else {
      await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: `Cliente não no Omie: ${exp.erro}`, omie_enviado: false });
      return { sucesso: false, erro: `Cliente não no Omie: ${exp.erro}`, pedido_id };
    }
  }

  // Já existe → alterar
  if (resultado?.faultstring && /(já cadastrado|já existe|código.*cadastrado|codigo.*cadastrado)/i.test(resultado.faultstring)) {
    resultado = await omieCall(base44, "AlterarPedidoVenda", payload);
  }

  // Redundante → consultar
  if (resultado?.faultstring && /redundan/i.test(resultado.faultstring)) {
    try {
      const consulta = await omieCall(base44, "ConsultarPedido", { codigo_pedido_integracao: pedido.id }, { maxTentativas: 2 });
      if (consulta?.pedido_venda_produto?.cabecalho?.codigo_pedido) {
        resultado = { codigo_pedido: consulta.pedido_venda_produto.cabecalho.codigo_pedido, numero_pedido: consulta.pedido_venda_produto.cabecalho.numero_pedido };
      }
    } catch {
      const pedidoAtual = await base44.asServiceRole.entities.Pedido.get(pedido_id).catch(() => null);
      if (pedidoAtual?.omie_codigo_pedido) {
        resultado = { codigo_pedido: pedidoAtual.omie_codigo_pedido, numero_pedido: pedidoAtual.numero_pedido };
      }
    }
  }

  if (resultado?.faultstring) {
    const pedidoAtual = await base44.asServiceRole.entities.Pedido.get(pedido_id).catch(() => null);
    if (pedidoAtual?.omie_codigo_pedido) {
      await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: resultado.faultstring, omie_enviado: true });
      console.log(`[PERF] Pedido ${pedido_id}: ${Date.now() - t0}ms | sucesso: true (já existia)`);
      return { sucesso: true, pedido_id, codigo_pedido_omie: pedidoAtual.omie_codigo_pedido, numero_pedido_omie: pedidoAtual.numero_pedido, duracao_ms: Date.now() - t0 };
    }
    await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: resultado.faultstring, omie_enviado: false });
    console.log(`[PERF] Pedido ${pedido_id}: ${Date.now() - t0}ms | sucesso: false`);
    return { sucesso: false, erro: resultado.faultstring, pedido_id, duracao_ms: Date.now() - t0 };
  }

  const codigoOmie = resultado.codigo_pedido || resultado.codigo_pedido_omie || null;
  const numeroPedidoOmie = resultado.numero_pedido || resultado.numero_pedido_omie || null;
  const updateData = {
    omie_codigo_pedido: codigoOmie != null ? String(codigoOmie) : null,
    omie_enviado: true, omie_erro: null,
    status: pedido.status === 'pendente' ? 'enviado' : pedido.status,
    data_envio: pedido.data_envio || new Date().toISOString()
  };
  if (numeroPedidoOmie) {
    updateData.numero_pedido = String(numeroPedidoOmie);
    const dadosAtuais = pedido.dados_adicionais_nf || '';
    const semPrefixo = dadosAtuais.replace(/^Pedido Nº: .+?(\s*\|\s*|$)/, '').trim();
    const partes = [`Pedido Nº: ${numeroPedidoOmie}`];
    if (semPrefixo) partes.push(semPrefixo);
    updateData.dados_adicionais_nf = partes.join(' | ');
  }
  await base44.asServiceRole.entities.Pedido.update(pedido_id, updateData);

  console.log(`[PERF] Pedido ${pedido_id}: ${Date.now() - t0}ms | sucesso: true`);
  return { sucesso: true, pedido_id, codigo_pedido_omie: codigoOmie, numero_pedido_omie: numeroPedidoOmie, duracao_ms: Date.now() - t0 };
}

// ============================================================
// ENTRY POINT — processamento da fila (autocontido)
// ============================================================
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Permite: admin logado OU chamada via service role (automações agendadas)
    const isAuthenticated = await base44.auth.isAuthenticated();
    if (isAuthenticated) {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    }
    // Se não autenticado como user, continua (service role da automação)

    // Circuit breaker — com auto-desbloqueio
    const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
      .filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
    const controle = cb?.[0];
    if (controle?.bloqueado) {
      if (controle.bloqueado_ate && new Date(controle.bloqueado_ate) <= new Date()) {
        // Expirou — desbloquear automaticamente
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => {});
        console.log(`[processarFila] Circuit breaker expirado — auto-desbloqueado`);
      } else {
        console.log(`[processarFila] Circuit breaker ATIVO até ${controle.bloqueado_ate}. Abortando.`);
        return Response.json({ sucesso: true, mensagem: 'Circuit breaker ativo', bloqueado_ate: controle.bloqueado_ate, processados: 0 });
      }
    }

    // ============================================================
    // LOCK "1 CADEIA POR VEZ" — adquirido no INÍCIO, segurado por TODO o
    // processamento e liberado na ordem certa no fim (try/finally). TTL de
    // ~2min é a rede de segurança se a função morrer. Se já há uma cadeia
    // ativa (worker_rodando + worker_lock_ate no futuro) → retorna skipped.
    // ============================================================
    const lock = await adquirirLockEncadeamento(base44);
    if (!lock.adquirido) {
      console.log('[processarFila] Lock ativo — outra cadeia já está processando. Skipped.');
      return Response.json({ sucesso: true, mensagem: 'Lock ativo (1 cadeia por vez)', skipped: 'lock', processados: 0 });
    }

    const inicioExecucao = Date.now();
    const resultadosGlobais = [];
    let cbAtivadoGlobal = false;
    let rodadas = 0;

    try {

    // ============================================================
    // ANTI-STUCK — recupera itens presos em "processando" há >15min.
    // Causa típica: a função morreu (timeout/deploy) deixando o item
    // marcado, OU o Pedido de origem foi excluído após entrar na fila.
    // - Pedido inexistente  → erro terminal (órfão, descartado).
    // - Pedido existe + tentativas < 3 → volta a 'pendente' (reprocessa).
    // - tentativas >= 3 → erro terminal.
    // ============================================================
    const LIMITE_STUCK_MS = 15 * 60 * 1000; // 15min
    const presos = await base44.asServiceRole.entities.FilaEnvioPedidoOmie
      .filter({ status: 'processando' }, 'updated_date', 50).catch(() => []);
    const agora = Date.now();
    let recuperados = 0, orfaos = 0;
    for (const item of presos) {
      const marcadoEm = new Date(item.updated_date || item.processado_em || 0).getTime();
      if (agora - marcadoEm < LIMITE_STUCK_MS) continue; // ainda dentro da janela — pode estar rodando agora

      const leituraStuck = item.pedido_id
        ? await lerPedidoSeguro(base44, item.pedido_id)
        : { naoExiste: true };
      const pedidoOrigem = leituraStuck.pedido || null;

      if (!pedidoOrigem && leituraStuck.transitorio) {
        // Falha transitória de leitura — NÃO descartar. Volta a pendente para reprocessar.
        await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
          status: 'pendente',
          erro_log: 'Falha transitória ao ler pedido (anti-stuck) — mantido para retry'
        }).catch(() => {});
        recuperados++;
        continue;
      }

      if (!pedidoOrigem) {
        // Inexistente confirmado 2x → órfão real, erro terminal.
        await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
          status: 'erro',
          erro_log: 'Pedido de origem não existe mais (excluído, confirmado 2x) — item descartado',
          processado_em: new Date().toISOString()
        }).catch(() => {});
        orfaos++;
        console.log(`[processarFila][anti-stuck] Item ${item.id} órfão (pedido ${item.pedido_id} inexistente, confirmado) → erro terminal`);
        continue;
      }

      if ((item.tentativas || 0) >= MAX_TENTATIVAS) {
        await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
          status: 'erro',
          erro_log: `Preso em processando há >15min e já tentou ${item.tentativas}x — erro terminal`,
          processado_em: new Date().toISOString()
        }).catch(() => {});
        continue;
      }

      await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
        status: 'pendente',
        erro_log: 'Recuperado: estava preso em processando há >15min'
      }).catch(() => {});
      recuperados++;
    }
    if (presos.length > 0) {
      console.log(`[processarFila][anti-stuck] ${presos.length} em processando | recuperados=${recuperados} | órfãos=${orfaos}`);
    }

    // ============================================================
    // LOOP EXTERNO — drena a fila numa única execução até esvaziar
    // ou bater o teto de tempo seguro (abaixo do timeout de 180s).
    // A próxima execução continua de onde parou.
    // ============================================================
    while ((Date.now() - inicioExecucao) < TETO_EXECUCAO_MS && !cbAtivadoGlobal) {

    // Buscar pendentes (próximo lote)
    const pendentes = await base44.asServiceRole.entities.FilaEnvioPedidoOmie
      .filter({ status: 'pendente' }, 'created_date', MAX_PEDIDOS_POR_RODADA);

    if (pendentes.length === 0) {
      break; // fila limpa
    }

    rodadas++;
    const t0 = Date.now();
    console.log(`[processarFila] Rodada ${rodadas}: processando ${pendentes.length} pedidos da fila`);

    // ============================================================
    // PRÉ-CARREGAMENTO EM LOTE (antes do loop)
    // ============================================================
    const pedidoIds = pendentes.map(p => p.pedido_id).filter(Boolean);

    // Buscar pedidos em LOTES SERIALIZADOS (5 por vez) para não saturar o banco
    // e gerar o 429 interno que originava o falso "Pedido não encontrado".
    // Cada leitura distingue inexistente (404 confirmado 2x) de falha transitória.
    const pedidosMap = {};
    const pedidoLeituraStatus = {}; // pedido_id → 'ok' | 'naoExiste' | 'transitorio'
    const LOTE_LEITURA = 5;
    for (let li = 0; li < pedidoIds.length; li += LOTE_LEITURA) {
      const fatia = pedidoIds.slice(li, li + LOTE_LEITURA);
      const leituras = await Promise.all(fatia.map(id => lerPedidoSeguro(base44, id)));
      fatia.forEach((id, idx) => {
        const r = leituras[idx];
        if (r.pedido) { pedidosMap[id] = r.pedido; pedidoLeituraStatus[id] = 'ok'; }
        else if (r.naoExiste) { pedidoLeituraStatus[id] = 'naoExiste'; }
        else { pedidoLeituraStatus[id] = 'transitorio'; }
      });
      if (li + LOTE_LEITURA < pedidoIds.length) await sleep(120); // pequena pausa entre lotes
    }

    // Buscar todos os itens em paralelo
    const todosItems = await Promise.all(
      pedidoIds.map(id => base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: id }).catch(() => []))
    );
    const itemsPorPedido = {};
    pedidoIds.forEach((id, idx) => { itemsPorPedido[id] = todosItems[idx] || []; });

    // IDs únicos
    const clienteIds = [...new Set(Object.values(pedidosMap).map(p => p.cliente_id).filter(Boolean))];
    const produtoIds = [...new Set(Object.values(itemsPorPedido).flatMap(items => items.map(i => i.produto_id)).filter(Boolean))];
    const planoIds = [...new Set(Object.values(pedidosMap).map(p => p.plano_pagamento_id).filter(Boolean))];

    // Buscar clientes, produtos, planos e unidades em paralelo
    const [todosClientes, todosProdutos, todosPlanos, todasUnidades] = await Promise.all([
      Promise.all(clienteIds.map(id => base44.asServiceRole.entities.Cliente.get(id).catch(() => null))),
      Promise.all(produtoIds.map(id => base44.asServiceRole.entities.Produto.get(id).catch(() => null))),
      Promise.all(planoIds.map(id => base44.asServiceRole.entities.PlanoPagamento.get(id).catch(() => null))),
      base44.asServiceRole.entities.UnidadeMedida.list().catch(() => [])
    ]);

    const clientesPorId = {};
    todosClientes.forEach(c => { if (c) clientesPorId[c.id] = c; });
    const produtosMap = {};
    todosProdutos.forEach(p => { if (p) produtosMap[p.id] = p; });
    const planosPorId = {};
    todosPlanos.forEach(p => { if (p) planosPorId[p.id] = p; });
    const unidadesMap = {};
    todasUnidades.forEach(u => { if (u) unidadesMap[u.id] = u; });

    // Conta corrente (uma vez)
    const contaCorrentePadrao = await resolverContaCorrentePadrao(base44);

    console.log(`[processarFila] Pré-carregamento: ${Date.now() - t0}ms — ${clienteIds.length} clientes, ${produtoIds.length} produtos, ${planoIds.length} planos`);

    // ============================================================
    // LOOP DE ENVIO (dados pré-carregados, chamada direta)
    // ============================================================
    const resultados = [];
    let cbAtivado = false; // 🐛 FIX item5: flag local do circuit breaker (evita query por pedido)

    for (let i = 0; i < pendentes.length; i++) {
      const item = pendentes[i];
      const pedido = pedidosMap[item.pedido_id];

      if (!pedido) {
        const statusLeitura = pedidoLeituraStatus[item.pedido_id];

        if (statusLeitura === 'transitorio') {
          // FALHA TRANSITÓRIA de leitura (429/timeout/rede) → NÃO descartar.
          // Mantém pendente, incrementa tentativas e reprocessa no próximo ciclo (com teto).
          const tentativas = (item.tentativas || 0) + 1;
          if (tentativas >= MAX_TENTATIVAS_LEITURA) {
            await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
              status: 'erro',
              erro_log: `Falha ao ler pedido após ${tentativas} tentativas — erro terminal`,
              tentativas,
              processado_em: new Date().toISOString()
            });
            resultados.push({ pedido_id: item.pedido_id, sucesso: false, erro: 'Falha de leitura persistente' });
          } else {
            await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
              status: 'pendente',
              erro_log: 'Falha transitória ao ler pedido — mantido pendente para retry',
              tentativas,
              processado_em: null
            });
            console.log(`[processarFila] Item ${item.id}: leitura transitória do pedido ${item.pedido_id} → retry (${tentativas}/${MAX_TENTATIVAS_LEITURA})`);
            resultados.push({ pedido_id: item.pedido_id, sucesso: false, erro: 'Leitura transitória (retry)', transitorio: true });
          }
          continue;
        }

        // TERMINAL: pedido comprovadamente inexistente (404 confirmado por 2ª leitura).
        // Foi excluído após entrar na fila. Nunca reprocessar — órfão descartado.
        await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
          status: 'erro',
          erro_log: 'Pedido de origem não existe mais (excluído, confirmado 2x) — item descartado',
          processado_em: new Date().toISOString()
        });
        console.log(`[processarFila] Item ${item.id} órfão (pedido ${item.pedido_id} inexistente, confirmado) → erro terminal`);
        resultados.push({ pedido_id: item.pedido_id, sucesso: false, erro: 'Pedido de origem inexistente (órfão)' });
        continue;
      }

      // 🐛 FIX item5: CB verificado apenas se o pedido anterior gerou erro 425.
      // Antes: 1 query ao banco por pedido = 10 queries extras por rodada de 10.
      // Agora: variável local cbAtivado — atualizada somente quando omieCall lança bloqueio.
      if (cbAtivado) {
        console.log(`[processarFila] Circuit breaker ativado no pedido anterior. Abortando rodada.`);
        break;
      }

      // Marcar como processando
      await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
        status: 'processando',
        tentativas: (item.tentativas || 0) + 1
      });

      try {
        // Idempotência
        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
          await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
            status: 'concluido', codigo_pedido_omie: String(pedido.omie_codigo_pedido),
            numero_pedido_omie: pedido.numero_pedido ? String(pedido.numero_pedido) : null, processado_em: new Date().toISOString(), erro_log: null
          });
          resultados.push({ pedido_id: item.pedido_id, sucesso: true, mensagem: 'Já estava enviado' });
          continue;
        }

        // Chamar enviarUmPedido DIRETAMENTE com ctx completo (sem functions.invoke)
        const result = await enviarUmPedido(base44, item.pedido_id, {
          pedido,
          items: itemsPorPedido[item.pedido_id] || [],
          cliente: clientesPorId[pedido.cliente_id],
          plano: planosPorId[pedido.plano_pagamento_id],
          produtosMap,
          unidadesMap,
          contaCorrentePadrao
        });

        if (result?.sucesso) {
          await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
            status: 'concluido', codigo_pedido_omie: result.codigo_pedido_omie ? String(result.codigo_pedido_omie) : null,
            numero_pedido_omie: result.numero_pedido_omie ? String(result.numero_pedido_omie) : null,
            processado_em: new Date().toISOString(), erro_log: null
          });
          resultados.push({ pedido_id: item.pedido_id, sucesso: true, codigo: result.codigo_pedido_omie });
        } else {
          const erro = result?.erro || 'Erro desconhecido';
          const tentativas = (item.tentativas || 0) + 1;

          // Se o pedido já tem código Omie, tratar como sucesso
          if (pedido.omie_codigo_pedido) {
            if (!pedido.omie_enviado) {
              await base44.asServiceRole.entities.Pedido.update(item.pedido_id, { omie_enviado: true, omie_erro: null });
            }
            await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
              status: 'concluido', codigo_pedido_omie: String(pedido.omie_codigo_pedido),
              numero_pedido_omie: pedido.numero_pedido ? String(pedido.numero_pedido) : null, processado_em: new Date().toISOString(), erro_log: null
            });
            resultados.push({ pedido_id: item.pedido_id, sucesso: true, codigo: pedido.omie_codigo_pedido, mensagem: 'Recuperado' });
            continue;
          }

          const novoStatus = tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente';
          await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
            status: novoStatus, erro_log: erro,
            processado_em: novoStatus === 'erro' ? new Date().toISOString() : null
          });
          resultados.push({ pedido_id: item.pedido_id, sucesso: false, erro, tentativas });
        }
      } catch (err) {
        const erro = err?.message || 'Erro interno';
        const tentativas = (item.tentativas || 0) + 1;
        const novoStatus = tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente';
        const isBloqueio = /403|425|429|bloqueada|bloqueio|consumo indevido|suspens|inválida|invalida|suspended|rate.?limit/i.test(erro);

        await base44.asServiceRole.entities.FilaEnvioPedidoOmie.update(item.id, {
          status: isBloqueio ? 'pendente' : novoStatus,
          erro_log: erro,
          tentativas: isBloqueio ? (item.tentativas || 0) : tentativas,
          processado_em: (!isBloqueio && novoStatus === 'erro') ? new Date().toISOString() : null
        });
        resultados.push({ pedido_id: item.pedido_id, sucesso: false, erro });

        if (isBloqueio) {
          console.log(`[processarFila] Bloqueio detectado: ${erro}. Abrindo circuit breaker.`);
          // Extrai tempo real da mensagem Omie (ex: "1799 segundos"); se não informou, NÃO bloqueia
          const secsMatch = erro.match(/(\d+)\s*segundo/i);
          const secs = secsMatch ? Math.min(Number(secsMatch[1]), 1800) : 0;
          // SEMPRE update no registro fixo — NUNCA criar novo
          const CB_FIXED_ID = '6a1e06a9aa62ceab7b3b6d97';
          if (secs > 0) {
            await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_FIXED_ID, {
              bloqueado: true,
              bloqueado_ate: new Date(Date.now() + secs * 1000).toISOString(),
              ultimo_erro: erro,
              atualizado_em: new Date().toISOString()
            }).catch(() => {});
            cbAtivado = true;
          }
          // Mesmo sem bloquear o CB, para o lote para não agravar o rate limit
          break;
        }
      }

      // Aguardar intervalo entre pedidos — mantém ~2 req/s (sequencial, seguro).
      // Interrompe se bateu o teto de tempo da execução.
      if ((Date.now() - inicioExecucao) >= TETO_EXECUCAO_MS) break;
      await sleep(INTERVALO_ENTRE_PEDIDOS_MS);
    }

    // Propaga resultados e estado do circuit breaker para o loop externo
    resultadosGlobais.push(...resultados);
    if (cbAtivado) cbAtivadoGlobal = true;

    console.log(`[PERF] Rodada ${rodadas}: ${pendentes.length} pedidos em ${Date.now() - t0}ms.`);

    } // ── fim do while (loop externo / teto de tempo) ──

    const sucessos = resultadosGlobais.filter(r => r.sucesso).length;
    const erros = resultadosGlobais.filter(r => !r.sucesso).length;

    // ============================================================
    // AUTO-ENCADEAMENTO — mata o atraso de 5min entre lotes.
    // O lock JÁ está nosso (adquirido no início). Se ainda há pendente E o
    // circuit breaker está liberado, renovamos o lock (estende o TTL para a
    // próxima cadeia herdar a janela), disparamos o invoke fire-and-forget e
    // SÓ DEPOIS, no finally, liberamos — sem janela onde ninguém segura o lock.
    // Importante: a re-invocação tentará adquirir o lock; como a nova execução
    // só roda após esta liberar (no finally), ela o adquire normalmente.
    // ============================================================
    let encadeou = false;
    if (!cbAtivadoGlobal) {
      const restantes = await base44.asServiceRole.entities.FilaEnvioPedidoOmie
        .filter({ status: 'pendente' }, 'created_date', 1).catch(() => []);
      if (restantes.length > 0) {
        const breaker = await checkCircuitBreaker(base44);
        if (!breaker.blocked) {
          // fire-and-forget: não aguarda a resposta para não somar latência
          base44.asServiceRole.functions.invoke('processarFilaEnvioPedidoOmie', {}).catch(() => {});
          encadeou = true;
          console.log('[processarFila] Auto-encadeamento disparado — fila ainda tem pendentes.');
        }
      }
    }

    console.log(`[PERF] Execução concluída: ${rodadas} rodada(s), ${resultadosGlobais.length} pedidos em ${Date.now() - inicioExecucao}ms. Sucessos: ${sucessos}. Erros: ${erros}.`);

    if (resultadosGlobais.length === 0) {
      return Response.json({ sucesso: true, mensagem: 'Nenhum pedido na fila', processados: 0, encadeou });
    }

    return Response.json({
      sucesso: true,
      rodadas,
      processados: resultadosGlobais.length,
      sucessos, erros,
      circuit_breaker_ativado: cbAtivadoGlobal,
      encadeou,
      duracao_ms: Date.now() - inicioExecucao,
      resultados: resultadosGlobais
    });

    } finally {
      // Libera o lock SEMPRE ao fim do processamento (sucesso, retorno antecipado
      // ou exceção). A re-invocação encadeada adquire o seu próprio lock em seguida.
      await liberarLockEncadeamento(base44).catch(() => {});
    }
  } catch (error) {
    console.error('[processarFila] Erro fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});