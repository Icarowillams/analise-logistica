import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const base44 = createClientFromRequest(req, { body });
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { pedido_ids = [], troca_ids = [] } = body;
    const result = { itens_pedido: {}, itens_troca: {} };

    // Buscar itens de pedidos — filtro $in em lotes de 40, queries paralelas para reduzir tempo/timeout
    if (pedido_ids.length > 0) {
      const chunks = [];
      for (let i = 0; i < pedido_ids.length; i += 40) {
        chunks.push(pedido_ids.slice(i, i + 40));
      }
      const resultados = await Promise.all(
        chunks.map(chunk => base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: { $in: chunk } }, '-created_date', 2000))
      );
      for (const itens of resultados) {
        for (const item of itens) {
          if (!result.itens_pedido[item.pedido_id]) result.itens_pedido[item.pedido_id] = [];
          result.itens_pedido[item.pedido_id].push(item);
        }
      }
    }

    // Buscar itens de trocas
    if (troca_ids.length > 0) {
      const trocaIdSet = new Set(troca_ids);
      const todosItensTroca = await base44.asServiceRole.entities.ItemPedidoTroca.list('-created_date', 5000);
      for (const item of todosItensTroca) {
        if (trocaIdSet.has(item.pedido_troca_id)) {
          if (!result.itens_troca[item.pedido_troca_id]) result.itens_troca[item.pedido_troca_id] = [];
          result.itens_troca[item.pedido_troca_id].push(item);
        }
      }
    }

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});