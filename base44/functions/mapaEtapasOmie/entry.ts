// mapaEtapasOmie — monta no servidor o mapa enxuto codigo_pedido -> {etapa, numero_pedido, numero_nf, status_real, status_label}
// para a coluna "Etapa Omie" do GerenciarPedidos. Evita o frontend baixar ~966 registros COMPLETOS (~2MB).
// asServiceRole ignora RLS (igual indiceCargasPorPedido). SDK 0.8.31.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const espelho = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('-sincronizado_em', 5000);

    // Lista já vem ordenada por -sincronizado_em (mais recente primeiro). Para cada chave,
    // só gravamos se ainda não existir — assim o registro mais recente (que aparece primeiro)
    // nunca é sobrescrito por um espelho mais antigo do mesmo pedido.
    const map = {};
    const setIfAbsent = (k, info) => { if (k && map[k] === undefined) map[k] = info; };
    for (const p of (espelho || [])) {
      const info = {
        etapa: String(p.etapa || ""),
        numero_pedido: p.numero_pedido ?? null,
        numero_nf: p.numero_nf ?? null,
        status_real: p.status_real ?? null,
        status_label: p.status_label ?? null,
        codigo_pedido: p.codigo_pedido ?? null,
        sincronizado_em: p.sincronizado_em ?? null,
      };
      if (p.codigo_pedido) {
        const raw = String(p.codigo_pedido).trim();
        setIfAbsent(raw, info);
        const asInt = String(parseInt(raw, 10));
        if (asInt !== "NaN" && asInt !== raw) setIfAbsent(asInt, info);
      }
      if (p.numero_pedido) setIfAbsent(`np:${String(p.numero_pedido).trim()}`, info);
    }

    return Response.json({ sucesso: true, total: (espelho || []).length, map }, { status: 200 });
  } catch (e) {
    return Response.json({ sucesso: false, error: String(e?.message || e) }, { status: 200 });
  }
});