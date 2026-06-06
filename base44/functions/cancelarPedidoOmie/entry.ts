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
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

// Etapas do Omie para Venda de Produto (operação 11):
// 10 = Pedido de Venda
// 20 = Pedidos Liberados (Separar Estoque)
// 50 = Faturar
// 60 = Faturado
const ETAPAS_CANCELAVEIS = ['10', '20'];

const ETAPA_NOMES = {
    '10': 'Pedido de Venda',
    '20': 'Pedidos Liberados',
    '50': 'Faturar',
    '60': 'Faturado',
};

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


async function consultarPedidoOmie(base44, codigoPedido) {
    const result = await omieCall(base44, "ConsultarPedido", { codigo_pedido: Number(codigoPedido) }, { skipLog: true });
    console.log('[cancelarPedidoOmie] ConsultarPedido resposta:', JSON.stringify(result).substring(0, 2000));
    return result;
}

async function excluirPedidoOmie(base44, codigoPedido) {
    const result = await omieCall(base44, "ExcluirPedido", { codigo_pedido: Number(codigoPedido) });
    console.log('[cancelarPedidoOmie] ExcluirPedido resposta:', JSON.stringify(result).substring(0, 1000));
    return result;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { pedido_id, motivo } = body;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        if (!motivo || !motivo.trim()) {
            return Response.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 });
        }

        // Buscar pedido no Base44
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        let omieCancelado = false;
        let omieErro = null;
        let etapaAtual = null;
        let etapaNome = null;

        // Se o pedido foi enviado ao Omie, verificar etapa antes de cancelar
        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
            const codigoPedido = Number(pedido.omie_codigo_pedido);
            console.log('[cancelarPedidoOmie] Consultando etapa do pedido Omie:', codigoPedido);

            // 1. Consultar pedido no Omie para verificar a etapa
            const consultaResult = await consultarPedidoOmie(base44, codigoPedido);

            if (!consultaResult) {
                return Response.json({
                    sucesso: false,
                    error: 'Não foi possível consultar o pedido no Omie. Tente novamente.'
                }, { status: 500 });
            }

            // Se o Omie retornou erro (pedido já excluído/não encontrado)
            if (consultaResult.faultstring || consultaResult.faultcode) {
                const faultMsg = (consultaResult.faultstring || '').toLowerCase();
                const jaExcluido = faultMsg.includes('não encontrad') ||
                    faultMsg.includes('nao encontrad') ||
                    faultMsg.includes('excluíd') ||
                    faultMsg.includes('excluid') ||
                    faultMsg.includes('cancelad');

                if (jaExcluido) {
                    // Pedido já não existe no Omie, cancelar apenas localmente
                    console.log('[cancelarPedidoOmie] Pedido já não existe no Omie. Cancelando apenas localmente.');
                    omieCancelado = true;
                } else {
                    return Response.json({
                        sucesso: false,
                        error: `Erro ao consultar pedido no Omie: ${consultaResult.faultstring}`
                    }, { status: 400 });
                }
            } else if (consultaResult.pedido_venda_produto) {
                // Pedido existe no Omie — verificar etapa
                etapaAtual = consultaResult.pedido_venda_produto.cabecalho?.etapa;
                etapaNome = ETAPA_NOMES[etapaAtual] || `Etapa ${etapaAtual}`;
                const canceladoOmie = consultaResult.pedido_venda_produto.infoCadastro?.cancelado;

                console.log(`[cancelarPedidoOmie] Etapa atual: ${etapaAtual} (${etapaNome}), cancelado: ${canceladoOmie}`);

                // Se já está cancelado no Omie
                if (canceladoOmie === 'S') {
                    console.log('[cancelarPedidoOmie] Pedido já está cancelado no Omie.');
                    omieCancelado = true;
                }
                // Verificar se a etapa permite cancelamento
                else if (!ETAPAS_CANCELAVEIS.includes(etapaAtual)) {
                    return Response.json({
                        sucesso: false,
                        error: `Não é possível cancelar este pedido. Ele está na etapa "${etapaNome}" (${etapaAtual}) no Omie. Só é possível cancelar pedidos nas etapas: Pedido de Venda (10) ou Pedidos Liberados (20).`,
                        etapa_atual: etapaAtual,
                        etapa_nome: etapaNome
                    }, { status: 400 });
                }
                else {
                    // Etapa é cancelável — executar exclusão no Omie (API só suporta exclusão)
                    console.log(`[cancelarPedidoOmie] Etapa ${etapaAtual} permite cancelamento. Excluindo no Omie...`);
                    const excluirResult = await excluirPedidoOmie(base44, codigoPedido);

                    if (excluirResult && !excluirResult.faultstring && !excluirResult.faultcode) {
                        omieCancelado = true;
                        console.log('[cancelarPedidoOmie] Pedido excluído com sucesso no Omie!');
                    } else {
                        omieErro = excluirResult?.faultstring || 'Falha ao excluir no Omie';
                        console.error('[cancelarPedidoOmie] Erro ao excluir:', omieErro);
                        // Retornar erro sem cancelar localmente
                        return Response.json({
                            sucesso: false,
                            error: `Erro ao cancelar pedido no Omie: ${omieErro}`,
                            etapa_atual: etapaAtual,
                            etapa_nome: etapaNome
                        }, { status: 400 });
                    }
                }
            }
        }

        // Buscar nome do funcionário pelo email
        let nomeUsuario = user.full_name || user.email;
        try {
            const vendedores = await base44.asServiceRole.entities.Vendedor.filter({ email: user.email });
            if (vendedores.length > 0) {
                nomeUsuario = vendedores[0].nome;
            }
        } catch (e) { /* usa full_name como fallback */ }

        // Atualizar pedido no Base44 como cancelado
        await base44.asServiceRole.entities.Pedido.update(pedido_id, {
            status: 'cancelado',
            cancelado_por: user.email,
            cancelado_por_nome: nomeUsuario,
            data_cancelamento: new Date().toISOString(),
            motivo_cancelamento: motivo.trim(),
            omie_erro: omieErro
        });

        console.log('[cancelarPedidoOmie] Pedido cancelado localmente. Omie excluído:', omieCancelado);

        return Response.json({
            sucesso: true,
            omie_cancelado: omieCancelado,
            etapa_cancelada: etapaAtual,
            etapa_nome: etapaNome,
            mensagem: omieCancelado
                ? `Pedido cancelado com sucesso (etapa: ${etapaNome || 'N/A'})`
                : 'Pedido cancelado no sistema (não estava no Omie)'
        });

    } catch (error) {
        console.error('[cancelarPedidoOmie] Erro geral:', error.message);
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, sucesso: false, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});