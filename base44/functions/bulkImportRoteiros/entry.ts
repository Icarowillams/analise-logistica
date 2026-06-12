import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const roteirosNovos = Array.isArray(body?.roteiros) ? body.roteiros : [];
    if (roteirosNovos.length === 0) return Response.json({ criados: 0, atualizados: 0 });

    const existentes = await base44.entities.Roteiro.list('-created_date', 5000);

    // Normaliza o dia para comparação robusta (ignora acentos e sufixo "-feira")
    const normalizarDia = (d) => String(d || '').toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/-feira$/, '');

    let criados = 0, atualizados = 0;
    for (const r of roteirosNovos) {
      const diaNorm = normalizarDia(r.dia_semana);
      const existente = existentes.find(x => x.vendedor_id === r.vendedor_id && normalizarDia(x.dia_semana) === diaNorm);
      if (existente) {
        // MESCLA (não sobrescreve): preserva os clientes que já estão no roteiro
        // e adiciona apenas os que vieram no CSV e ainda não existem.
        // Isso evita que uma importação parcial apague clientes existentes.
        const idsAtuais = existente.clientes_ids || [];
        const detalhesAtuais = existente.clientes_detalhes || [];
        const idsExistentes = new Set(idsAtuais);

        const novosIds = [];
        const novosDetalhes = [];
        (r.clientes_detalhes || []).forEach(det => {
          if (det?.cliente_id && !idsExistentes.has(det.cliente_id)) {
            idsExistentes.add(det.cliente_id);
            novosIds.push(det.cliente_id);
            novosDetalhes.push(det);
          }
        });

        if (novosIds.length > 0) {
          const detalhesMesclados = [...detalhesAtuais, ...novosDetalhes]
            .map((d, i) => ({ ...d, ordem: i + 1 }));
          await base44.entities.Roteiro.update(existente.id, {
            clientes_ids: [...idsAtuais, ...novosIds],
            clientes_detalhes: detalhesMesclados,
            vendedor_nome: r.vendedor_nome || existente.vendedor_nome
          });
          // mantém o objeto em memória atualizado para o próximo item do lote
          existente.clientes_ids = [...idsAtuais, ...novosIds];
          existente.clientes_detalhes = detalhesMesclados;
        }
        atualizados++;
      } else {
        const criado = await base44.entities.Roteiro.create(r);
        criados++;
        existentes.push(criado || r); // evita criar duplicata dentro do mesmo lote
      }
    }

    return Response.json({ criados, atualizados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});