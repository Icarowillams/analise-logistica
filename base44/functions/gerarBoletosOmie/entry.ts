// deploy v3 — 2026-06-11 — 100% sequencial + delays anti-8020/CÓDIGO 6 + retry espaçado de concorrência
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
      // Tratamento de status HTTP ANTES de res.json() — num 5xx/429 o corpo não costuma ser JSON.
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 425) {
          const _cbId = '6a1e06a9aa62ceab7b3b6d97';
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p: any = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error') || msg.includes('chave de acesso') || msg.includes('chave inválid') || msg.includes('chave invalid') || msg.includes('acesso está inválid') || msg.includes('acesso esta invalid')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
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

const OMIE_URL_BOLETO = 'https://app.omie.com.br/api/v1/financas/contareceberboleto/';
const OMIE_URL_CR = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const STATUS_ABERTOS = new Set(['ABERTO', 'A VENCER', 'A PAGAR', 'A RECEBER', 'VENCIDO', 'PARCIAL', 'ATRASADO']);
// GerarBoleto Omie só aceita 1 requisição simultânea (erro 8020 se paralelo)
const DELAY_ENTRE_BOLETOS_MS = 1800; // delay entre cada boleto (sequencial) — espaçamento anti-flood Omie
const DELAY_ENTRE_CR_MS = 800; // delay entre chamadas ListarContasReceber por pedido

// Detecta erros de concorrência/redundância do Omie (8020 / CÓDIGO 6)
function isConcorrenciaOmie(msg: string): boolean {
  const m = String(msg || '').toLowerCase();
  return m.includes('8020')
    || m.includes('já existe uma requisição') || m.includes('ja existe uma requisicao')
    || m.includes('sendo executada') || m.includes('em execução') || m.includes('em execucao')
    || m.includes('redundante') || m.includes('aguarde')
    || m.includes('código 6') || m.includes('codigo 6');
}

// Wrapper anti-8020: tenta a chamada Omie; se vier erro de concorrência, espera 3s e tenta +1 vez.
async function omieCallAntiConcorrencia(base44: any, endpoint: string, param: unknown, options: any = {}) {
  try {
    return await omieCall(base44, endpoint, param, options);
  } catch (e: any) {
    if (isConcorrenciaOmie(e.message)) {
      await new Promise(r => setTimeout(r, 3000));
      return await omieCall(base44, endpoint, param, options);
    }
    throw e;
  }
}


// Cache em memória (isolate-scoped) para ListarContasReceber por CNPJ+janela
// Evita repetir a mesma varredura quando vários títulos do mesmo cliente são processados
const _crCache = new Map<string, { data: any[]; at: number }>();
const CR_CACHE_TTL_MS = 5 * 60_000; // 5 minutos

async function listarTitulosDoPedido(base44: any, codigoPedido: string | number) {
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  let cnpj: string | null = null;
  let numPedido: string | null = null;
  let dataPedido: Date | null = null;
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1);
    const pedido = pedidos?.[0];
    if (pedido) {
      cnpj = String(pedido.cliente_cpf_cnpj || '').replace(/\D/g, '');
      numPedido = pedido.numero_pedido ? String(pedido.numero_pedido).trim() : null;
      const dataRef = pedido.data_faturamento || pedido.created_date;
      if (dataRef) dataPedido = new Date(dataRef);
      // Pedido costuma vir sem cliente_cpf_cnpj — busca no Cliente vinculado.
      if (!cnpj && pedido.cliente_id) {
        const clis = await base44.asServiceRole.entities.Cliente.filter({ id: pedido.cliente_id }, '-created_date', 1).catch(() => []);
        cnpj = String(clis?.[0]?.cnpj_cpf || '').replace(/\D/g, '') || null;
      }
    }
  } catch { /* fallback */ }

  if (!cnpj) {
    console.warn('[listarTitulosDoPedido] Pedido', codigoPedido, 'sem CNPJ');
    return [];
  }

  // Janela estreita: ±30 dias em torno da data do pedido (antes era ~15 meses)
  const ref = dataPedido || new Date();
  const inicio = new Date(ref.getTime() - 30 * 86400000);
  const futuro = new Date(ref.getTime() + 30 * 86400000);

  // Cruza SÓ pelo pedido: nCodPedido (prioridade) == omie_codigo_pedido, fallback numero_pedido.
  // Boleto NÃO depende de NF. Se nada casar, retorna [] (pedido sem boleto = normal).
  const codPedStr = String(codigoPedido);
  const getCodPedido = (t: any) => String(t.nCodPedido ?? t.codigo_pedido ?? t.cabec_titulo?.nCodPedido ?? t.cabec_titulo?.codigo_pedido ?? '');
  const getNumPedido = (t: any) => String(t.numero_pedido ?? t.cabec_titulo?.numero_pedido ?? '').trim();
  const filtrarPorPedido = (titulos: any[]) => {
    const porCodigo = titulos.filter((t: any) => getCodPedido(t) === codPedStr);
    if (porCodigo.length > 0) return porCodigo;
    if (numPedido) {
      const porNumero = titulos.filter((t: any) => getNumPedido(t) === numPedido);
      if (porNumero.length > 0) return porNumero;
    }
    return [];
  };

  // Cache por CNPJ+janela — evita varreduras repetidas do mesmo cliente em sequência
  const cacheKey = `${cnpj}_${fmt(inicio)}_${fmt(futuro)}`;
  const cached = _crCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CR_CACHE_TTL_MS) {
    console.log(`[listarTitulosDoPedido] Cache hit para CNPJ ${cnpj.slice(0,6)}...`);
    return filtrarPorPedido(cached.data);
  }

  let acumulados: any[] = [];
  for (let pag = 1; pag <= 3; pag++) { // reduzido de 5 para 3 páginas (janela menor)
    const data = await omieCallAntiConcorrencia(base44, 'financas/contareceber/', {
      pagina: pag, registros_por_pagina: 100, apenas_importado_api: 'N',
      filtrar_por_data_de: fmt(inicio), filtrar_por_data_ate: fmt(futuro),
      filtrar_por_cpf_cnpj: cnpj, filtrar_apenas_titulos_em_aberto: 'S'
    }, { call: 'ListarContasReceber' });
    const lista = data?.conta_receber_cadastro || [];
    acumulados.push(...lista);
    if (pag >= (data?.total_de_paginas || 1)) break;
    await new Promise(r => setTimeout(r, DELAY_ENTRE_CR_MS));
  }

  _crCache.set(cacheKey, { data: acumulados, at: Date.now() });
  console.log(`[listarTitulosDoPedido] ${acumulados.length} títulos para CNPJ ${cnpj.slice(0,6)}... (janela: ${fmt(inicio)} a ${fmt(futuro)})`);

  return filtrarPorPedido(acumulados);
}

// Extrai os campos de contexto do título de entrada (para gravar no LogEmissaoBoleto).
// O frontend agora envia o objeto completo do título, não só o código.
function contextoTitulo(titulo: any) {
  return {
    numero_pedido: String(titulo.numero_pedido_vinculado || titulo.numero_pedido || '').trim(),
    numero_nf: String(titulo.numero_documento || titulo.numero_nf || '').trim(),
    cliente_nome: titulo.nome_cliente || titulo.cliente_nome || '',
    cliente_id: titulo.cliente_id || '',
    valor: Number(titulo.valor_documento || titulo.valor || 0),
    data_vencimento: titulo.data_vencimento || ''
  };
}

// Processa um único título e retorna o resultado
async function processarTitulo(base44: any, titulo: any): Promise<any> {
  let codigo = titulo.codigo_lancamento_omie || titulo.codigo_lancamento || (typeof titulo !== 'object' ? titulo : '');
  const ctx = contextoTitulo(titulo);

  // EMITIR DIRETO PELO PEDIDO: título veio sem nCodTitulo mas com codigo_pedido_omie
  // (busca de título falhou/não retornou). Resolve o título no Omie pelo pedido — afinal o
  // objetivo é gerar o boleto, e o pedido com NF tem título lá. Se não houver título de verdade,
  // o Omie retorna vazio e marcamos pendência real.
  if (!codigo && titulo?.codigo_pedido_omie) {
    try {
      const titulosPedido = await listarTitulosDoPedido(base44, titulo.codigo_pedido_omie);
      if (!titulosPedido || titulosPedido.length === 0) {
        return { codigo_lancamento: '', sucesso: false, mensagem: 'Nenhum título encontrado no Omie para este pedido', ...ctx };
      }
      // Usa o primeiro título aberto do pedido; reaproveita o objeto Omie (tem nCodTitulo/status/boleto).
      const tomie = titulosPedido[0];
      codigo = tomie.codigo_lancamento_omie || tomie.nCodTitulo || '';
      // Reaproveita status/boleto do Omie para a validação abaixo.
      titulo = { ...titulo, status_titulo: tomie.status_titulo || titulo.status_titulo, boleto: tomie.boleto, codigo_lancamento: codigo };
    } catch (e: any) {
      return { codigo_lancamento: '', sucesso: false, mensagem: `Falha ao resolver título do pedido: ${e.message}`, ...ctx };
    }
  }
  if (!codigo) return { codigo_lancamento: '', sucesso: false, mensagem: 'Título sem código de lançamento', ...ctx };
  const status = String(titulo.status_titulo || '').toUpperCase();
  const aberto = !status || STATUS_ABERTOS.has(status);
  const jaTemBoleto = !!(titulo.numero_boleto && String(titulo.numero_boleto).trim()) || titulo.boleto?.cGerado === 'S';

  if (!aberto) return { codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Título ${status}`, ...ctx };
  if (jaTemBoleto) return { codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Boleto já gerado: ${titulo.numero_boleto || ''}`, ...ctx };

  const isRateLimit = (msg: string) => {
    const m = String(msg || '').toLowerCase();
    return m.includes('425') || m.includes('429') || m.includes('consumo indevido') ||
           m.includes('bloqueada') || m.includes('bloqueio') || m.includes('cota') || m.includes('aguarde');
  };

  try {
    const param = { nCodTitulo: Number(codigo) };
    // Backoff/retry no rate-limit (425/429): espera e re-tenta o MESMO título; nunca marca erro por isso.
    let data: any;
    let tentRate = 0;
    while (true) {
      try {
        data = await omieCallAntiConcorrencia(base44, 'financas/contareceberboleto/', param, { call: 'GerarBoleto' });
        break;
      } catch (e: any) {
        if (isRateLimit(e.message) && tentRate < 3) {
          tentRate++;
          await new Promise(r => setTimeout(r, 5000 * tentRate)); // 5s, 10s, 15s
          continue;
        }
        throw e;
      }
    }

    const codStatus = String(data.cCodStatus || '0');
    if (codStatus !== '0' && codStatus !== '') {
      return { codigo_lancamento: codigo, sucesso: false, mensagem: data.cDesStatus || `Erro Omie (status ${codStatus})`, resposta_omie: data };
    }

    const numBoleto = data.cNumBoleto || '';
    const codBarras = data.cCodBarras || '';
    const linkBoleto = data.cLinkBoleto || '';
    const numBancario = data.cNumBancario || '';
    const sucessoReal = !!(String(numBoleto).trim() || String(codBarras).trim() || String(linkBoleto).trim());

    return {
      codigo_lancamento: codigo, sucesso: sucessoReal,
      numero_boleto: numBoleto, codigo_barras: codBarras, linha_digitavel: '',
      link_boleto: linkBoleto, numero_bancario: numBancario,
      data_emissao_boleto: data.dDtEmBol || '',
      mensagem: sucessoReal ? 'Boleto gerado com sucesso' : 'Omie respondeu sem dados de boleto — verifique a conta corrente/convênio bancário no Omie',
      ...ctx
    };
  } catch (err: any) {
    const msg = err.message || '';
    return {
      codigo_lancamento: codigo, sucesso: false,
      skip: msg.toLowerCase().includes('liquidado') || msg.toLowerCase().includes('baixado') || msg.toLowerCase().includes('cancelado'),
      mensagem: msg,
      ...ctx
    };
  }
}

// Write-through COMPLETO no LogEmissaoBoleto (idempotente por codigo_lancamento).
// Para cada boleto gerado com sucesso, cria OU atualiza a linha local — assim a próxima
// abertura da carga vem 100% do local (instantâneo) sem consultar o Omie.
// Falha de gravação local NÃO quebra o fluxo (o boleto no Omie é o que importa).
async function gravarLogBoleto(base44: any, r: any, ctxCarga: any, user: any) {
  if (!r?.sucesso) return;
  const codigo = String(r.codigo_lancamento || '').trim();
  if (!codigo) return;
  try {
    const payload: any = {
      codigo_lancamento: codigo,
      numero_pedido: r.numero_pedido || '',
      numero_nf: r.numero_nf || '',
      numero_boleto: r.numero_boleto || '',
      numero_bancario: r.numero_bancario || '',
      codigo_barras: r.codigo_barras || '',
      linha_digitavel: r.linha_digitavel || '',
      link_boleto: r.link_boleto || '',
      valor: Number(r.valor || 0),
      data_emissao_boleto: r.data_emissao_boleto || '',
      data_vencimento: r.data_vencimento || '',
      cliente_nome: r.cliente_nome || '',
      cliente_id: r.cliente_id || '',
      numero_carga: ctxCarga.numero_carga || '',
      carga_id: ctxCarga.carga_id || '',
      lote_id: ctxCarga.lote_id || '',
      status: 'gerado',
      usuario_email: user?.email || 'sistema (auto)',
      usuario_nome: user?.full_name || ''
    };
    // Idempotência: 1 linha por codigo_lancamento — atualiza se já existir.
    const existentes = await base44.asServiceRole.entities.LogEmissaoBoleto.filter(
      { codigo_lancamento: codigo }, '-created_date', 1
    ).catch(() => []);
    if (existentes?.[0]) {
      await base44.asServiceRole.entities.LogEmissaoBoleto.update(existentes[0].id, payload);
    } else {
      await base44.asServiceRole.entities.LogEmissaoBoleto.create(payload);
    }
  } catch (e: any) {
    console.warn('[gravarLogBoleto] falha ao gravar log local do boleto', codigo, e?.message);
  }
}

// Processa títulos SEQUENCIALMENTE — GerarBoleto Omie não aceita chamadas paralelas (erro 8020)
async function gerarBoletosTitulos(base44: any, titulosEntrada: any[]) {
  const resultados: any[] = [];

  // Dedup — nunca gera o mesmo boleto 2x na mesma rodada (evita CÓDIGO 6 redundante).
  // Chave = codigo_lancamento quando houver; senão pedido:<codigo_pedido_omie> (títulos emitíveis
  // direto pelo pedido, sem nCodTitulo resolvido ainda).
  const vistos = new Set<string>();
  const titulos = (titulosEntrada || []).filter((t: any) => {
    const cod = String(t.codigo_lancamento_omie || t.codigo_lancamento || (typeof t !== 'object' ? t : '') || '');
    const chave = cod || (t?.codigo_pedido_omie ? `pedido:${t.codigo_pedido_omie}` : '');
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  for (let i = 0; i < titulos.length; i++) {
    const resultado = await processarTitulo(base44, titulos[i]);
    resultados.push(resultado);

    // Delay entre boletos para não acionar o rate-limit do Omie
    if (i < titulos.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_ENTRE_BOLETOS_MS));
    }
  }
  return resultados;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { origem = 'manual', pedidos = [], titulos = [], id_conta_corrente, numero_carga = '', carga_id = '' } = body;

    let user: any = null;
    try { user = await base44.auth.me(); } catch { user = null; }
    // origem 'auto' = chamada interna do webhook (service role, sem usuário) → permitida.
    // origem 'manual' = ação de tela → exige usuário autenticado.
    if (!user && origem !== 'auto') return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let titulosParaGerar: any[] = [];
    if (origem === 'auto') {
      const codigosPedido = pedidos.map((p: any) => p.codigo_pedido || p).filter(Boolean);
      for (let ci = 0; ci < codigosPedido.length; ci++) {
        const codigoPedido = codigosPedido[ci];
        const titulosPedido = await listarTitulosDoPedido(base44, codigoPedido);
        titulosParaGerar.push(...titulosPedido.map((t: any) => ({ ...t, codigo_pedido: codigoPedido })));
        // Delay entre pedidos para não acionar concorrência/redundância no ListarContasReceber
        if (ci < codigosPedido.length - 1) await new Promise(r => setTimeout(r, DELAY_ENTRE_CR_MS));
      }
    } else {
      if (!Array.isArray(titulos) || titulos.length === 0) return Response.json({ error: 'titulos vazio' }, { status: 400 });
      titulosParaGerar = titulos;
    }

    const startedAt = Date.now();
    const resultados = await gerarBoletosTitulos(base44, titulosParaGerar);
    const duracao_ms = Date.now() - startedAt;

    // Write-through local: grava TODO boleto gerado com sucesso no LogEmissaoBoleto
    // (idempotente por codigo_lancamento). Próxima abertura da carga vem do local.
    const loteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ctxCarga = { numero_carga: String(numero_carga || ''), carga_id: String(carga_id || ''), lote_id: loteId };
    for (const r of resultados) {
      await gravarLogBoleto(base44, r, ctxCarga, user);
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso && !r.skip).length;
    const skips = resultados.filter(r => r.skip).length;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'financas/contareceberboleto',
      call: 'GerarBoleto',
      operacao: origem === 'auto' ? 'gerar_boletos_auto' : 'gerar_boletos_lote',
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} boletos falharam` : null,
      duracao_ms,
      tentativas: titulosParaGerar.length,
      usuario_email: user?.email || 'sistema (auto)',
      payload_resposta: JSON.stringify(resultados).slice(0, 2000)
    }).catch(() => {});

    return Response.json({
      sucesso: true, origem,
      total: titulosParaGerar.length, processados: titulosParaGerar.length,
      sucessos, erros, skips, duracao_ms,
      resultados
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});