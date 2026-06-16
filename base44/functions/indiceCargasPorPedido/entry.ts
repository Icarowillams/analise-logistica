import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // service-role ignora RLS — frontend Pedido.list() volta vazio por RLS de created_by.
    const pedidos = await base44.asServiceRole.entities.Pedido.list('-created_date', 5000);
    const indice = {}; // omie_codigo_pedido(=nIdPedido) → numero_carga
    for (const p of pedidos) {
      const cod = String(p.omie_codigo_pedido || '');
      const carga = p.numero_carga;
      if (cod && carga != null && carga !== '' && !indice[cod]) indice[cod] = String(carga);
    }
    return Response.json({ sucesso: true, indice, total: pedidos.length });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});