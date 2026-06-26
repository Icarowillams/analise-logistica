import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Resolve Cliente + Nº NF para o Histórico de Boletos.
// O frontend não consegue ler Carga/pedidos_omie por RLS (created_by), então este
// endpoint roda com service-role e devolve um índice "numero_carga|numero_pedido(sem zeros)"
// → { nome, nf } a partir dos pedidos_omie das cargas referenciadas nos logs.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const numerosCarga = [...new Set((body.numeros_carga || []).map(c => String(c || '').trim()).filter(Boolean))];
    if (numerosCarga.length === 0) return Response.json({ sucesso: true, indice: {} });

    const limpo = (v) => String(v || '').trim().replace(/^0+/, '');
    const indice = {};

    // Busca as cargas referenciadas (service-role ignora RLS).
    const cargas = await base44.asServiceRole.entities.Carga.filter(
      { numero_carga: { $in: numerosCarga } }, '-created_date', 1000
    );

    for (const c of cargas) {
      const numCarga = String(c.numero_carga || '').trim();
      for (const p of (c.pedidos_omie || [])) {
        const chave = `${numCarga}|${limpo(p.numero_pedido)}`;
        if (chave && !indice[chave]) {
          indice[chave] = {
            nome: p.nome_cliente || p.nome_fantasia || '',
            nf: limpo(p.numero_nf)
          };
        }
      }
    }

    return Response.json({ sucesso: true, indice });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});