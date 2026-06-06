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
const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  return null;
}
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

// omieCall robusto: circuit breaker + 425 (bloqueio 30min, sem retry) + retry 429 + log padronizado.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, produtos = [], tipo_retorno = 'devolucao_parcial', motivo_geral = '', carga_id = null } = body;
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });
    if (produtos.length === 0) return Response.json({ error: 'produtos vazio' }, { status: 400 });

    const consulta = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigo_pedido) }, { call: 'ConsultarPedido' });
    const pedido = consulta?.pedido_venda_produto;
    if (!pedido) return Response.json({ error: 'Pedido não encontrado no Omie' }, { status: 404 });

    // Detecção precisa de cancelamento
    const flagCancelado = pedido?.infoCadastro?.cancelado;
    const etapaAtual = String(pedido?.cabecalho?.etapa || '');
    if (flagCancelado === 'S' || etapaAtual === '99') {
      return Response.json({ error: 'Pedido cancelado: não é permitido editar ou ajustar.' }, { status: 400 });
    }

    // Regra: só pode devolver/ajustar pedidos nas etapas 10/20/50 (antes do faturamento).
    const ETAPAS_AJUSTAVEIS = ['10', '20', '50'];
    const ETAPA_NOMES_MAP = { '10': 'Pedido de Venda', '20': 'Liberados (Pendente)', '50': 'Faturar (Montagem)', '60': 'Faturado', '70': 'Entrega' };
    if (!ETAPAS_AJUSTAVEIS.includes(etapaAtual)) {
      const nome = ETAPA_NOMES_MAP[etapaAtual] || `Etapa ${etapaAtual}`;
      return Response.json({
        error: `Não é possível devolver/ajustar este pedido. Está na etapa "${nome}" (${etapaAtual}). Apenas pedidos Pendentes, Liberados ou em Montagem podem ser ajustados.`,
        etapa_atual: etapaAtual, etapa_nome: nome
      }, { status: 400 });
    }

    const produtosDevolver = produtos.map(p => ({
      nCodProd: Number(p.nCodProd || p.codigo_produto),
      nQtde: Number(p.quantidade)
    }));

    let erroOmie = null;
    let nIdDevolucao = null;
    try {
      const resp = await omieCall(base44, 'produtos/pedido/', {
        nCodPed: Number(codigo_pedido),
        produtos: produtosDevolver
      }, { call: 'DevolverPedido' });
      // Captura nIdDevolucao retornado pelo Omie para rastreio
      nIdDevolucao = resp?.nIdDevolucao || resp?.nCodDevolucao || null;
    } catch (err) {
      if (err.code === 'OMIE_425') throw err; // propaga bloqueio ao catch externo
      erroOmie = err.message;
    }

    // Calcula valor total da devolução
    const valorTotal = produtos.reduce((s, p) => s + (Number(p.valor_unitario || 0) * Number(p.quantidade || 0)), 0);

    const registro = await base44.asServiceRole.entities.Retorno.create({
      pedido_codigo_omie: String(codigo_pedido),
      carga_id,
      data_retorno: new Date().toISOString().slice(0, 10),
      produtos: produtos.map(p => ({
        codigo_produto: String(p.nCodProd || p.codigo_produto),
        descricao: p.descricao || '',
        quantidade: Number(p.quantidade),
        valor_unitario: Number(p.valor_unitario || 0),
        valor_total: Number(p.valor_unitario || 0) * Number(p.quantidade),
        motivo: p.motivo || motivo_geral
      })),
      tipo_retorno,
      valor_total_retorno: valorTotal,
      motivo_geral,
      status: erroOmie ? 'pendente' : 'devolvido_omie',
      observacoes: nIdDevolucao ? `nIdDevolucao Omie: ${nIdDevolucao}` : null
    });

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'DevolverPedido',
      operacao: 'devolver_pedido',
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: erroOmie ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    if (erroOmie) return Response.json({ error: erroOmie, registro_id: registro.id }, { status: 500 });
    return Response.json({ sucesso: true, registro_id: registro.id, valor_total: valorTotal, nIdDevolucao });
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});