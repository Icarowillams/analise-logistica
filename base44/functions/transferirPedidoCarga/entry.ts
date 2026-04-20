import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Transfere um pedido de uma carga para outra (operação LOCAL, não chama Omie)
// body: { pedido_codigo_omie, carga_origem_id, carga_destino_id, motivo }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { pedido_codigo_omie, carga_origem_id, carga_destino_id, motivo = '' } = body;
    if (!pedido_codigo_omie || !carga_origem_id || !carga_destino_id) {
      return Response.json({ error: 'pedido_codigo_omie, carga_origem_id e carga_destino_id obrigatórios' }, { status: 400 });
    }

    const origem = await base44.asServiceRole.entities.Carga.get(carga_origem_id);
    const destino = await base44.asServiceRole.entities.Carga.get(carga_destino_id);
    if (!origem || !destino) return Response.json({ error: 'Carga origem ou destino não encontrada' }, { status: 404 });

    const pedido = (origem.pedidos_omie || []).find(p => String(p.codigo_pedido) === String(pedido_codigo_omie));
    if (!pedido) return Response.json({ error: 'Pedido não está na carga origem' }, { status: 404 });

    // Remove da origem
    const novosPedidosOrigem = (origem.pedidos_omie || []).filter(p => String(p.codigo_pedido) !== String(pedido_codigo_omie));
    const valorOrigem = novosPedidosOrigem.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);

    // Adiciona no destino
    const novosPedidosDestino = [...(destino.pedidos_omie || []), pedido];
    const valorDestino = novosPedidosDestino.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);

    await base44.asServiceRole.entities.Carga.update(carga_origem_id, {
      pedidos_omie: novosPedidosOrigem,
      quantidade_pedidos: novosPedidosOrigem.length,
      valor_total: valorOrigem
    });

    await base44.asServiceRole.entities.Carga.update(carga_destino_id, {
      pedidos_omie: novosPedidosDestino,
      quantidade_pedidos: novosPedidosDestino.length,
      valor_total: valorDestino
    });

    const registro = await base44.asServiceRole.entities.Transferencia.create({
      pedido_codigo_omie: String(pedido_codigo_omie),
      numero_pedido: String(pedido.numero_pedido || ''),
      cliente_nome: pedido.nome_cliente || '',
      carga_origem_id,
      carga_origem_numero: origem.numero_carga,
      carga_destino_id,
      carga_destino_numero: destino.numero_carga,
      motivo,
      valor_nf: pedido.valor_total_pedido || 0,
      funcionario_nome: user.full_name || user.email,
      status: 'concluida'
    });

    return Response.json({ sucesso: true, registro_id: registro.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});