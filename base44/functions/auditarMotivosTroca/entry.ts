import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TIPOS_TROCA = new Set(['troca', 'devolucao', 'bonificacao']);

function temMotivoItem(item) {
  return Boolean(item?.motivo_troca_id || item?.motivo_troca_descricao || item?.motivo_id || item?.motivo_descricao || item?.motivo || item?.observacao);
}

function resumoItem(item) {
  return {
    id: item.id || null,
    produto_id: item.produto_id || '',
    produto_codigo: item.produto_codigo || item.codigo_produto || '',
    produto_nome: item.produto_nome || item.produto_descricao || item.descricao || '',
    quantidade: item.quantidade || 0,
    motivo_troca_id: item.motivo_troca_id || '',
    motivo_troca_descricao: item.motivo_troca_descricao || '',
    motivo_id: item.motivo_id || '',
    motivo_descricao: item.motivo_descricao || '',
    motivo: item.motivo || '',
    observacao: item.observacao || ''
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const pedidos = await base44.asServiceRole.entities.Pedido.list('-created_date', 5000);
    const pedidosTroca = pedidos.filter(p => TIPOS_TROCA.has(p.tipo));
    const comMotivo = [];
    const semMotivo = [];

    for (const pedido of pedidosTroca) {
      const [pedidoItems, pedidosTrocaFormais] = await Promise.all([
        base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: pedido.id }),
        base44.asServiceRole.entities.PedidoTroca.filter({ pedido_venda_id: pedido.id }).catch(() => [])
      ]);

      const itemPedidoTrocaGrupos = [];
      for (const pt of pedidosTrocaFormais) {
        const itens = await base44.asServiceRole.entities.ItemPedidoTroca.filter({ pedido_troca_id: pt.id }).catch(() => []);
        itemPedidoTrocaGrupos.push({ pedido_troca: pt, itens });
      }

      const itensPedidoResumo = pedidoItems.map(resumoItem);
      const itensTrocaResumo = itemPedidoTrocaGrupos.flatMap(g => g.itens.map(resumoItem));
      const todosItens = [...itensPedidoResumo, ...itensTrocaResumo];
      const itensSemMotivo = todosItens.filter(item => !temMotivoItem(item));
      const possuiMotivoGeral = Boolean(pedido.motivo_troca || pedido.motivo_troca_descricao || pedidosTrocaFormais.some(pt => pt.motivo_id || pt.motivo_descricao || pt.observacoes));
      const possuiMotivoItem = todosItens.some(temMotivoItem);

      const registro = {
        id: pedido.id,
        numero_pedido: pedido.numero_pedido || '',
        cliente_nome: pedido.cliente_nome || '',
        tipo: pedido.tipo,
        status: pedido.status || '',
        data: pedido.created_date || pedido.data_previsao_entrega || '',
        motivo_geral: pedido.motivo_troca || pedido.motivo_troca_descricao || '',
        total_itens_pedido: pedidoItems.length,
        total_itens_troca_formal: itensTrocaResumo.length,
        itens_sem_motivo: itensSemMotivo,
        itens_com_motivo: todosItens.filter(temMotivoItem)
      };

      if (possuiMotivoGeral || possuiMotivoItem) comMotivo.push(registro);
      else semMotivo.push(registro);
    }

    return Response.json({
      sucesso: true,
      total_pedidos_troca: pedidosTroca.length,
      total_com_motivo: comMotivo.length,
      total_sem_motivo: semMotivo.length,
      pedidos_sem_motivo: semMotivo,
      pedidos_com_motivo: comMotivo.slice(0, 100)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});