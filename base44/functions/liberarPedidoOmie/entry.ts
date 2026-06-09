import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const OMIE_BASE_URL = "https://app.omie.com.br/api/v1/";
const DEFAULT_TIMEOUT_MS = 15000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const CB_ID_LIBERAR = '6a1e06a9aa62ceab7b3b6d97';

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

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID_LIBERAR }, '-created_date', 1).catch(() => []);
  const control = rows?.[0];
  if (!control?.bloqueado) return { blocked: false };
  const blockedUntil = control.bloqueado_ate ? new Date(control.bloqueado_ate).getTime() : 0;
  if (blockedUntil && blockedUntil <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_LIBERAR, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => {});
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: control.bloqueado_ate, lastError: control.ultimo_erro };
}

async function setCircuitBreakerBlocked(base44, errorMessage) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ id: CB_ID_LIBERAR }, '-created_date', 1).catch(() => []);
  const ctrl = rows?.[0];
  const erros = Number(ctrl?.erros_consecutivos || 0) + 1;
  const threshold = Number(ctrl?.threshold_erros ?? 3);
  const payload = { erros_consecutivos: erros, ultimo_erro: errorMessage.slice(0, 500), atualizado_em: new Date().toISOString() };
  if (erros >= threshold) {
    payload.bloqueado = true;
    payload.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString();
  }
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_LIBERAR, payload).catch(() => {});
}

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
      const data = text ? JSON.parse(text) : {};
      if (!response.ok || data?.faultstring || data?.faultcode) {
        const msg = data?.faultstring || `Erro HTTP ${response.status}`;
        const lower = msg.toLowerCase();
        const faultLower = String(data?.faultcode || '').toLowerCase();
        if (faultLower.includes('misuse') || lower.includes('consumo indevido') || lower.includes('misuse')) {
          await setCircuitBreakerBlocked(base44, `MISUSE: ${msg}`);
        } else if (lower.includes('cota') || lower.includes('limite') || lower.includes('bloque') || lower.includes('suspended') || response.status === 403 || response.status === 425) {
          await setCircuitBreakerBlocked(base44, msg);
        }
        return data;
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID_LIBERAR, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
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

async function omieCall(base44, ...args) {
  const [callOrEndpoint, param, opts] = args;
  if (opts !== undefined || (typeof callOrEndpoint === 'string' && callOrEndpoint.includes('/'))) {
    return omieCallDirect(base44, callOrEndpoint, param, opts || {});
  }
  return omieCallDirect(base44, 'produtos/pedido/', param, { call: callOrEndpoint });
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // P7-prep (16/05): permissão granular — admin sempre passa,
        // demais usuários precisam ter `permissoes_pedidos.enviar_pedido` ativo
        // (mesma permissão que já controla envio ao Omie).
        if (user.role !== 'admin') {
            // 🐛 FIX: Vendedor.list() sem limite pode não retornar todos — filter por email é O(1)
            const vendedoresPorEmail = await base44.asServiceRole.entities.Vendedor.filter({ email: user.email }).catch(() => []);
            const vendedor = vendedoresPorEmail[0] || null;
            if (!vendedor) {
                return Response.json({ error: 'Funcionário não encontrado no cadastro' }, { status: 403 });
            }
            const permissoes = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedor.id });
            const perm = permissoes[0];
            if (!perm?.permissoes_pedidos?.enviar_pedido) {
                return Response.json({ error: 'Sem permissão para liberar pedidos' }, { status: 403 });
            }
        }

        const body = await req.json();
        let { pedido_id, etapa } = body;

        // Aceita numero_pedido como alternativa ao pedido_id (útil para correções manuais via painel)
        if (!pedido_id && body.numero_pedido) {
            const encontrados = await base44.asServiceRole.entities.Pedido
                .filter({ numero_pedido: String(body.numero_pedido) }, '-created_date', 1)
                .catch(() => []);
            pedido_id = encontrados[0]?.id;
            if (!pedido_id) {
                return Response.json({ error: `Pedido numero_pedido='${body.numero_pedido}' não encontrado` }, { status: 404 });
            }
        }

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id ou numero_pedido é obrigatório' }, { status: 400 });
        }

        // etapa: "10" = Pedido de Venda, "20" = Pedidos Liberados (Separar)
        const etapaOmie = etapa || "20";

        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
            return Response.json({ sucesso: true, mensagem: 'Pedido não está no Omie, operação apenas local' });
        }

        if (pedido.tipo === 'troca') {
            return Response.json({ sucesso: true, mensagem: 'Pedido de Troca não integra com Omie' });
        }

        const codigoPedidoOmie = Number(pedido.omie_codigo_pedido);
        if (!codigoPedidoOmie || isNaN(codigoPedidoOmie)) {
            console.error(`[liberarPedidoOmie] codigo_pedido inválido: ${pedido.omie_codigo_pedido} (tipo: ${typeof pedido.omie_codigo_pedido})`);
            return Response.json({ sucesso: false, erro: `Código do pedido Omie inválido: ${pedido.omie_codigo_pedido}` });
        }

        const etapaLabel = etapaOmie === "20" ? "Pedidos Liberados" : "Pedido de Venda";
        console.log(`[liberarPedidoOmie] Alterando etapa do pedido ${codigoPedidoOmie} para ${etapaOmie} (${etapaLabel})`);

        const param = {
            codigo_pedido: codigoPedidoOmie,
            etapa: etapaOmie
        };

        console.log('[liberarPedidoOmie] Payload:', JSON.stringify(param));

        const resultado = await omieCall(base44, "TrocarEtapaPedido", param);
        console.log('[liberarPedidoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            console.error('[liberarPedidoOmie] Erro Omie:', resultado.faultstring);
            return Response.json({ sucesso: false, erro: resultado.faultstring });
        }

        console.log(`[liberarPedidoOmie] Pedido ${codigoPedidoOmie} movido para ${etapaLabel} no Omie com sucesso!`);

        // Atualiza o Pedido local para refletir a etapa no Omie (não depende do frontend)
        if (etapaOmie === "20") {
          await base44.asServiceRole.entities.Pedido.update(pedido_id, {
            status: 'liberado',
            data_liberacao: new Date().toISOString(),
            liberado_por: user.email,
            liberado_por_nome: user.full_name || user.email
          }).catch(e => console.warn('[liberarPedidoOmie] Falha ao atualizar status local:', e.message));

          // Sincroniza espelho PedidoLiberadoOmie para etapa 20 imediatamente.
          // Evita que o espelho fique desatualizado quando o webhook EtapaAlterada é descartado.
          const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
            { codigo_pedido: String(codigoPedidoOmie) }
          ).catch(() => []);
          for (const esp of espelhos) {
            await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
              etapa: '20',
              sincronizado_em: new Date().toISOString(),
              origem_sync: 'liberacao'
            }).catch(e => console.warn('[liberarPedidoOmie] Falha ao atualizar espelho:', e.message));
          }
        }

        return Response.json({ sucesso: true, mensagem: `Pedido movido para ${etapaLabel} no Omie` });

    } catch (error) {
        console.error('[liberarPedidoOmie] Erro:', error.message);
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, sucesso: false, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});