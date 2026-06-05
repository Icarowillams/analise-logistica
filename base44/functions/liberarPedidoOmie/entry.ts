import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7: migrado para _shared/omieClient
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

// 🐛 FIX: Credenciais REMOVIDAS do top-level do módulo (risco em Deno Deploy warm starts).
// resolverCredsOmie lê dinamicamente do banco a cada chamada, com fallback para env vars.
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

// ✅ resolverCreds removida — _shared/omieClient

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
// ✅ resolverCreds removida — _shared/omieClient

// ✅ omieCall local removida — wrapper para _shared/omieClient  
async function omieCall(base44, ...args) {
  // Detecta chamada (base44, call, param) ou (base44, endpoint, param, opts)
  const [callOrEndpoint, param, opts] = args;
  if (opts !== undefined || (typeof callOrEndpoint === 'string' && callOrEndpoint.includes('/'))) {
    return omieCallShared(base44, callOrEndpoint, param, opts || {});
  }
  return omieCallShared(base44, 'produtos/pedido/', param, { call: callOrEndpoint });
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
        const { pedido_id, etapa } = body;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
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
        }

        return Response.json({ sucesso: true, mensagem: `Pedido movido para ${etapaLabel} no Omie` });

    } catch (error) {
        console.error('[liberarPedidoOmie] Erro:', error.message);
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, sucesso: false, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});