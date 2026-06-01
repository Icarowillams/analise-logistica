import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const roteirosNovos = Array.isArray(body?.roteiros) ? body.roteiros : [];
    if (roteirosNovos.length === 0) return Response.json({ criados: 0, atualizados: 0 });

    const existentes = await base44.entities.Roteiro.list('-created_date', 5000);

    let criados = 0, atualizados = 0;
    for (const r of roteirosNovos) {
      const existente = existentes.find(x => x.vendedor_id === r.vendedor_id && x.dia_semana === r.dia_semana);
      if (existente) {
        await base44.entities.Roteiro.update(existente.id, {
          clientes_ids: r.clientes_ids,
          clientes_detalhes: r.clientes_detalhes,
          vendedor_nome: r.vendedor_nome
        });
        atualizados++;
      } else {
        await base44.entities.Roteiro.create(r);
        criados++;
      }
    }

    return Response.json({ criados, atualizados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});