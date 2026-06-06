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

const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) { const entry = memoryCache.get(key); return entry && (Date.now() - entry.ts) < ttlMs ? entry.data : null; }
function setMemoryCache(key, data) { memoryCache.set(key, { data, ts: Date.now() }); }


// Lista pedidos da etapa 60 (Faturado) e cruza com ListarNF para devolver
// o status real de cada NF: emitida / rejeitada / cancelada / denegada / aguardando.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { registros_por_pagina = 50, pagina = 1, incluir_cancelados = false } = body;

    // 1) Pedidos etapa 60
    let pedidosData;
    try {
      pedidosData = await omieCall(base44, 'produtos/pedido/', {
        pagina,
        registros_por_pagina,
        apenas_importado_api: 'N',
        etapa: '60'
      }, { call: 'ListarPedidos' });
    } catch (e) {
      if (/n[ãa]o existem registros/i.test(e.message)) {
        return Response.json({ sucesso: true, pedidos: [] });
      }
      throw e;
    }

    const pedidos = (pedidosData.pedido_venda_produto || []).map(p => ({
      codigo_pedido: String(p.cabecalho?.codigo_pedido || ''),
      codigo_pedido_integracao: p.cabecalho?.codigo_pedido_integracao || '',
      numero_pedido: p.cabecalho?.numero_pedido || '',
      codigo_cliente: String(p.cabecalho?.codigo_cliente || ''),
      data_previsao: p.cabecalho?.data_previsao || '',
      etapa: p.cabecalho?.etapa || '',
      valor_total_pedido: p.total_pedido?.valor_total_pedido || 0,
      quantidade_itens: (p.det || []).length
    }));

    if (pedidos.length === 0) {
      return Response.json({ sucesso: true, pedidos: [] });
    }

    // 2) Consulta NFs nos últimos 90 dias
    const hoje = new Date();
    const dias90 = new Date(hoje.getTime() - 90 * 24 * 60 * 60 * 1000);
    const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    const nfsMap = {}; // codigo_pedido -> nf
    let paginaNf = 1;
    let totalPaginas = 1;
    do {
      try {
        const nfData = await omieCall(base44, 'produtos/nfconsultar/', {
          pagina: paginaNf,
          registros_por_pagina: 200,
          dEmiInicial: fmt(dias90),
          dEmiFinal: fmt(hoje)
        }, { call: 'ListarNF' });
        totalPaginas = nfData.nTotPaginas || 1;
        (nfData.nfCadastro || []).forEach(nf => {
          const idPed = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
          if (idPed) {
            nfsMap[idPed] = {
              numero_nf: nf.ide?.nNF || nf.cNumero || null,
              serie: nf.ide?.serie || nf.cSerie || null,
              chave: nf.compl?.cChaveNFe || nf.cChaveNFe || null,
              cStat: nf.ide?.cStat || nf.cStatus || null,
              dEmi: nf.ide?.dEmi || nf.dEmiNF || null,
              valor: nf.total?.ICMSTot?.vNF || nf.nValorNF || null
            };
          }
        });
        paginaNf++;
      } catch (e) {
        if (/n[ãa]o existem registros/i.test(e.message)) break;
        throw e;
      }
      if (paginaNf > 5) break; // limite de segurança
    } while (paginaNf <= totalPaginas);

    // 3) Cruza pedidos com NFs e classifica status real
    const enriquecidosTodos = pedidos.map(p => {
      const nf = nfsMap[p.codigo_pedido];
      let status_real = 'aguardando_nf'; // default: etapa 60 mas sem NF localizada
      let label = 'Aguardando NF';

      if (nf) {
        const stat = String(nf.cStat || '');
        // Códigos SEFAZ:
        // 100 = Autorizado | 101 = Cancelamento autorizado
        // 110, 301, 302 = Denegada | 135 = Evento registrado
        // 200-300 = rejeições
        if (stat === '100' || stat === '150') {
          status_real = 'emitida';
          label = `NF ${nf.numero_nf} emitida`;
        } else if (stat === '101' || stat === '135') {
          status_real = 'cancelada';
          label = `NF ${nf.numero_nf} cancelada`;
        } else if (['110', '301', '302', '205'].includes(stat)) {
          status_real = 'denegada';
          label = `NF denegada (${stat})`;
        } else if (stat && Number(stat) >= 200 && Number(stat) < 300) {
          status_real = 'rejeitada';
          label = `NF rejeitada (${stat})`;
        } else if (nf.numero_nf) {
          status_real = 'emitida';
          label = `NF ${nf.numero_nf}`;
        }
      }

      return {
        ...p,
        numero_nf: nf?.numero_nf || null,
        chave_nfe: nf?.chave || null,
        cStat: nf?.cStat || null,
        status_real,
        status_label: label
      };
    });

    const enriquecidos = incluir_cancelados
      ? enriquecidosTodos
      : enriquecidosTodos.filter(p => p.status_real !== 'cancelada' && p.status_real !== 'denegada');

    return Response.json({
      sucesso: true,
      pedidos: enriquecidos,
      total: enriquecidos.length,
      com_nf: enriquecidos.filter(p => p.numero_nf).length,
      rejeitadas: enriquecidos.filter(p => p.status_real === 'rejeitada').length,
      canceladas: enriquecidos.filter(p => p.status_real === 'cancelada').length,
      aguardando: enriquecidos.filter(p => p.status_real === 'aguardando_nf').length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});