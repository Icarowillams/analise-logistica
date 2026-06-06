// deploy v2 — 2026-06-06 — processamento em lotes paralelos (3 simultâneos) + delay reduzido
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

const OMIE_URL_BOLETO = 'https://app.omie.com.br/api/v1/financas/contareceberboleto/';
const OMIE_URL_CR = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const STATUS_ABERTOS = new Set(['ABERTO', 'A VENCER', 'A PAGAR', 'A RECEBER', 'VENCIDO', 'PARCIAL', 'ATRASADO']);
const BATCH_SIZE = 3;       // títulos processados em paralelo
const BATCH_DELAY_MS = 600; // delay entre lotes (respeita rate limit Omie)


async function listarTitulosDoPedido(base44: any, codigoPedido: string | number) {
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - 365 * 86400000);
  const futuro = new Date(hoje.getTime() + 90 * 86400000);

  let cnpj: string | null = null;
  let numNf: string | null = null;
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1);
    const pedido = pedidos?.[0];
    if (pedido) {
      cnpj = String(pedido.cliente_cpf_cnpj || '').replace(/\D/g, '');
      numNf = pedido.numero_nota_fiscal ? String(pedido.numero_nota_fiscal).replace(/\D/g, '') : null;
    }
  } catch { /* fallback */ }

  if (!cnpj) {
    console.warn('[listarTitulosDoPedido] Pedido', codigoPedido, 'sem CNPJ');
    return [];
  }

  let acumulados: any[] = [];
  for (let pag = 1; pag <= 5; pag++) {
    const data = await omieCall(base44, 'financas/contareceber/', {
      pagina: pag, registros_por_pagina: 100, apenas_importado_api: 'N',
      filtrar_por_data_de: fmt(inicio), filtrar_por_data_ate: fmt(futuro),
      filtrar_por_cpf_cnpj: cnpj, filtrar_apenas_titulos_em_aberto: 'S'
    }, { call: 'ListarContasReceber' });
    const lista = data?.conta_receber_cadastro || [];
    acumulados.push(...lista);
    if (pag >= (data?.total_de_paginas || 1)) break;
    await new Promise(r => setTimeout(r, 300));
  }

  if (numNf) {
    const comNf = acumulados.filter((t: any) => String(t.numero_documento || '').replace(/\D/g, '') === numNf);
    if (comNf.length > 0) return comNf;
  }
  return acumulados;
}

// Processa um único título e retorna o resultado
async function processarTitulo(base44: any, titulo: any): Promise<any> {
  const codigo = titulo.codigo_lancamento_omie || titulo.codigo_lancamento || titulo;
  const status = String(titulo.status_titulo || '').toUpperCase();
  const aberto = !status || STATUS_ABERTOS.has(status);
  const jaTemBoleto = !!(titulo.numero_boleto && String(titulo.numero_boleto).trim()) || titulo.boleto?.cGerado === 'S';

  if (!aberto) return { codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Título ${status}` };
  if (jaTemBoleto) return { codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Boleto já gerado: ${titulo.numero_boleto || ''}` };

  try {
    const param = { nCodTitulo: Number(codigo) };
    console.log('[GerarBoleto] Enviando para', codigo);
    const data = await omieCall(base44, 'financas/contareceberboleto/', param, { call: 'GerarBoleto' });

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
      mensagem: sucessoReal ? 'Boleto gerado com sucesso' : 'Omie respondeu sem dados de boleto — verifique a conta corrente/convênio bancário no Omie'
    };
  } catch (err: any) {
    const msg = err.message || '';
    return {
      codigo_lancamento: codigo, sucesso: false,
      skip: msg.toLowerCase().includes('liquidado') || msg.toLowerCase().includes('baixado') || msg.toLowerCase().includes('cancelado'),
      mensagem: msg
    };
  }
}

// Processa títulos em lotes paralelos de BATCH_SIZE
async function gerarBoletosTitulos(base44: any, titulos: any[]) {
  const resultados: any[] = [];

  for (let i = 0; i < titulos.length; i += BATCH_SIZE) {
    const lote = titulos.slice(i, i + BATCH_SIZE);
    const loteResultados = await Promise.allSettled(
      lote.map(titulo => processarTitulo(base44, titulo))
    );

    for (const r of loteResultados) {
      if (r.status === 'fulfilled') {
        resultados.push(r.value);
      } else {
        resultados.push({ sucesso: false, mensagem: r.reason?.message || 'Erro desconhecido' });
      }
    }

    // Delay entre lotes (só se há mais lotes restantes)
    if (i + BATCH_SIZE < titulos.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return resultados;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { origem = 'manual', pedidos = [], titulos = [], id_conta_corrente } = body;

    let user: any = null;
    try { user = await base44.auth.me(); } catch { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let titulosParaGerar: any[] = [];
    if (origem === 'auto') {
      const codigosPedido = pedidos.map((p: any) => p.codigo_pedido || p).filter(Boolean);
      for (const codigoPedido of codigosPedido) {
        const titulosPedido = await listarTitulosDoPedido(base44, codigoPedido);
        titulosParaGerar.push(...titulosPedido.map((t: any) => ({ ...t, codigo_pedido: codigoPedido })));
      }
    } else {
      if (!Array.isArray(titulos) || titulos.length === 0) return Response.json({ error: 'titulos vazio' }, { status: 400 });
      titulosParaGerar = titulos;
    }

    const startedAt = Date.now();
    const resultados = await gerarBoletosTitulos(base44, titulosParaGerar);
    const duracao_ms = Date.now() - startedAt;
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
      usuario_email: user.email,
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