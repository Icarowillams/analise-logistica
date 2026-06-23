import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Sincroniza notas do AcertoCaixa detectando NFs canceladas — via CRUZAMENTO LOCAL (rápido).
// O webhook já mantém o Pedido local atualizado: NF cancelada após faturamento deixa
// Pedido.status = 'cancelado_pos_faturamento'. Em vez de consultar o Omie nota por nota
// (lento, 1,2s cada + rate limit), cruzamos as notas com os Pedidos locais em lote.

function isPedidoCancelado(ped: any): boolean {
  // BLINDAGEM: só cancela quando o Pedido local FOI encontrado no cruzamento.
  // Ausência (ped indefinido) NUNCA marca cancelado — protege notas D1/troca e
  // qualquer nota cujo Pedido não tenha match por omie_codigo_pedido.
  if (!ped) return false;
  const status = String(ped.status || '').toLowerCase();
  const statusNf = String(ped.status_nota_fiscal || '').toLowerCase();
  return status === 'cancelado_pos_faturamento' ||
         status === 'cancelado' ||
         statusNf === 'cancelada' ||
         ped.cancelado_no_omie === true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { acerto_id } = await req.json().catch(() => ({}));
    if (!acerto_id) return Response.json({ error: 'acerto_id obrigatório' }, { status: 400 });

    const acerto = await base44.asServiceRole.entities.AcertoCaixa.get(acerto_id);
    if (!acerto) return Response.json({ error: 'Acerto não encontrado' }, { status: 404 });

    const notas = acerto.notas || [];

    // Códigos de pedido das notas (cruzam com Pedido.omie_codigo_pedido)
    const codigos = [...new Set(
      notas.map((n: any) => String(n.codigo_pedido || '').trim()).filter(Boolean)
    )];

    // Buscar Pedidos locais em lote (sem delay, sem Omie). Paginação por blocos de 'in'.
    const pedidosMap = new Map<string, any>();
    const LOTE = 100;
    for (let i = 0; i < codigos.length; i += LOTE) {
      const bloco = codigos.slice(i, i + LOTE);
      const pedidos = await base44.asServiceRole.entities.Pedido
        .filter({ omie_codigo_pedido: { $in: bloco } })
        .catch(() => []);
      for (const p of (pedidos || [])) {
        if (p.omie_codigo_pedido) pedidosMap.set(String(p.omie_codigo_pedido), p);
      }
    }

    let alteradas = 0;
    for (const nota of notas) {
      if (!nota.codigo_pedido) continue;
      // Pula notas já marcadas como canceladas no Omie
      if (nota.status_entrega === 'nao_entregue' && (nota.motivo_cancelamento || '').toLowerCase().includes('cancelada no omie')) continue;

      const ped = pedidosMap.get(String(nota.codigo_pedido).trim());
      if (isPedidoCancelado(ped)) {
        nota.status_entrega = 'nao_entregue';
        nota.valor_recebido = 0;
        nota.diferenca = -Number(nota.valor_original || 0);
        nota.motivo_cancelamento = 'Cancelada no Omie';
        alteradas++;
      }
    }

    // Recalcula totais
    const valor_total_recebido = notas.reduce((s: number, n: any) => s + Number(n.valor_recebido || 0), 0);
    const valor_total_diferenca = notas.reduce((s: number, n: any) => s + Number(n.diferenca || 0), 0);

    const updates: any = {
      notas,
      valor_total_recebido,
      valor_total_diferenca
    };

    // Se a carga foi cancelada no Omie, finaliza o acerto automaticamente
    let autoFinalizado = false;
    if (acerto.status_acerto === 'em_andamento' && acerto.carga_id) {
      const carga = await base44.asServiceRole.entities.Carga.get(acerto.carga_id).catch(() => null);
      if (carga?.status_carga === 'cancelada') {
        updates.status_acerto = 'finalizado';
        updates.finalizado_em = new Date().toISOString();
        updates.finalizado_por = 'auto-sync (carga cancelada no Omie)';
        autoFinalizado = true;
      }
    }

    await base44.asServiceRole.entities.AcertoCaixa.update(acerto_id, updates);

    return Response.json({ sucesso: true, alteradas, total: notas.length, autoFinalizado });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});