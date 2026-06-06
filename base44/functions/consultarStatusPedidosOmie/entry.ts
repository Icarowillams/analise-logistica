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

// Mapeamento de etapas do Omie para labels do Kanban
const ETAPA_LABELS = {
    '10': 'Pedido de Venda',
    '20': 'Pedidos Liberados',
    '50': 'Faturar',
    '60': 'Faturado',
    '70': 'Entrega',
    '80': 'Cancelado',
};

// ✅ omieCall wrapper limpo — sem fetch inline, sem credenciais globais

  if (endpointOrCall && endpointOrCall.includes('/')) {
    return omieCall(base44, endpointOrCall, param, {});
  }
  return omieCall(base44, 'produtos/pedido/', param, { call: endpointOrCall });
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { omie_codigos } = body; // Array de { pedido_id, omie_codigo_pedido }

        if (!omie_codigos || !Array.isArray(omie_codigos) || omie_codigos.length === 0) {
            return Response.json({ error: 'omie_codigos é obrigatório (array)' }, { status: 400 });
        }

        // Doc Omie: 240 req/min (4/s), 4 simultâneas. Em paralelo controlado é MUITO mais rápido.
        const codigos = omie_codigos.slice(0, 80);
        const resultados = {};
        const PARALELISMO = 3; // conservador (limite 4)
        let apiBloqueada = false;

        async function consultarUm(item, tent = 0) {
            if (item.tipo === 'troca') {
                return [item.pedido_id, { etapa: null, etapa_label: 'Troca (local)', cancelado: false, erro: false }];
            }
            const codigoPedido = Number(item.omie_codigo_pedido);
            if (!codigoPedido) {
                return [item.pedido_id, { etapa: null, etapa_label: 'Sem código Omie', cancelado: false, erro: true }];
            }
            try {
                const result = await omieCall(base44, "ConsultarPedido", { codigo_pedido: codigoPedido }, { skipLog: true });

                if (result.faultstring || result.faultcode) {
                    const faultMsg = (result.faultstring || '').toLowerCase();
                    const fc = String(result.faultcode || '');
                    const isRate = faultMsg.includes('limite de requisi') || faultMsg.includes('cota') || faultMsg.includes('aguarde')
                        || fc.includes('425') || fc.includes('520');
                    if (isRate && tent < 3) {
                        await new Promise(r => setTimeout(r, 2000 * (tent + 1)));
                        return consultarUm(item, tent + 1);
                    }
                    const naoEncontrado = faultMsg.includes('não encontrad') || faultMsg.includes('nao encontrad') ||
                        faultMsg.includes('excluíd') || faultMsg.includes('excluid') ||
                        faultMsg.includes('não existe') || faultMsg.includes('nao existe');
                    if (faultMsg.includes('bloqueada por consumo indevido')) {
                        apiBloqueada = true;
                        return [item.pedido_id, { etapa: null, etapa_label: null, cancelado: false, erro: false, api_bloqueada: true }];
                    }
                    return [item.pedido_id, {
                        etapa: naoEncontrado ? '80' : null,
                        etapa_label: naoEncontrado ? 'Excluído no Omie' : null,
                        cancelado: naoEncontrado,
                        erro: !naoEncontrado,
                        api_bloqueada: false,
                        mensagem_erro: result.faultstring || null
                    }];
                }
                if (result.pedido_venda_produto) {
                    const etapa = result.pedido_venda_produto.cabecalho?.etapa || null;
                    const cancelado = result.pedido_venda_produto.infoCadastro?.cancelado === 'S';
                    return [item.pedido_id, {
                        etapa,
                        etapa_label: cancelado ? 'Cancelado' : (ETAPA_LABELS[etapa] || `Etapa ${etapa}`),
                        cancelado,
                        erro: false
                    }];
                }
                return [item.pedido_id, { etapa: null, etapa_label: 'Resposta inesperada', cancelado: false, erro: true }];
            } catch (e) {
                console.error(`[consultarStatusPedidosOmie] Erro pedido ${item.pedido_id}:`, e.message);
                return [item.pedido_id, { etapa: null, etapa_label: 'Erro na consulta', cancelado: false, erro: true }];
            }
        }

        // Lotes paralelos respeitando o rate limit (240 req/min = 4/s)
        for (let i = 0; i < codigos.length; i += PARALELISMO) {
            if (apiBloqueada) {
                for (const r of codigos.slice(i)) {
                    if (!resultados[r.pedido_id]) {
                        resultados[r.pedido_id] = { etapa: null, etapa_label: null, cancelado: false, erro: false, api_bloqueada: true };
                    }
                }
                break;
            }
            const lote = codigos.slice(i, i + PARALELISMO);
            const pares = await Promise.all(lote.map(it => consultarUm(it)));
            for (const [pid, dados] of pares) resultados[pid] = dados;
            // 3 reqs em paralelo a cada ~1s = 180 req/min, abaixo do limite de 240
            if (i + PARALELISMO < codigos.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        return Response.json({ sucesso: true, resultados });

    } catch (error) {
        console.error('[consultarStatusPedidosOmie] Erro geral:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});