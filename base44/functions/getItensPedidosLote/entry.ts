import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { pedido_ids, troca_ids } = await req.json();
    const result = { itens_pedido: {}, itens_troca: {} };

    // Buscar itens de pedidos D1
    if (pedido_ids && pedido_ids.length > 0) {
      const todosItens = await base44.asServiceRole.entities.PedidoItem.list('-created_date', 5000);
      const pedidoIdSet = new Set(pedido_ids);
      for (const item of todosItens) {
        if (pedidoIdSet.has(item.pedido_id)) {
          if (!result.itens_pedido[item.pedido_id]) {
            result.itens_pedido[item.pedido_id] = [];
          }
          result.itens_pedido[item.pedido_id].push(item);
        }
      }
    }

    // Buscar itens de trocas
    if (troca_ids && troca_ids.length > 0) {
      const todosItensTroca = await base44.asServiceRole.entities.ItemPedidoTroca.list('-created_date', 5000);
      const trocaIdSet = new Set(troca_ids);
      for (const item of todosItensTroca) {
        if (trocaIdSet.has(item.pedido_troca_id)) {
          if (!result.itens_troca[item.pedido_troca_id]) {
            result.itens_troca[item.pedido_troca_id] = [];
          }
          result.itens_troca[item.pedido_troca_id].push(item);
        }
      }
    }

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});