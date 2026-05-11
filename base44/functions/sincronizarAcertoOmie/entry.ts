import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_KEY = Deno.env.get('OMIE_API_KEY');
const OMIE_SECRET = Deno.env.get('OMIE_API_SECRET');

// Sincroniza notas do AcertoCaixa com o status atual no Omie.
// Para cada nota, chama ConsultarPedido. Se etapa indicar cancelamento,
// marca a nota como nao_entregue com valor_recebido = 0.
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
    let alteradas = 0;

    for (const nota of notas) {
      if (!nota.codigo_pedido) continue;
      if (nota.status_entrega === 'nao_entregue' && (nota.motivo_cancelamento || '').toLowerCase().includes('cancelada no omie')) continue;

      const res = await fetch('https://app.omie.com.br/api/v1/produtos/pedido/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ConsultarPedido',
          app_key: OMIE_KEY,
          app_secret: OMIE_SECRET,
          param: [{ codigo_pedido: Number(nota.codigo_pedido) }]
        })
      });
      const data = await res.json().catch(() => ({}));
      const fs = (data?.faultstring || '').toLowerCase();
      const ped = data?.pedido_venda_produto || {};
      const etapa = ped?.cabecalho?.etapa || '';
      const isCancelado = fs.includes('cancelad') || etapa === '99' || etapa === 'cancelado';

      if (isCancelado) {
        nota.status_entrega = 'nao_entregue';
        nota.valor_recebido = 0;
        nota.diferenca = -Number(nota.valor_original || 0);
        nota.motivo_cancelamento = 'Cancelada no Omie';
        alteradas++;
      }
    }

    // Recalcula totais
    const valor_total_recebido = notas.reduce((s, n) => s + Number(n.valor_recebido || 0), 0);
    const valor_total_diferenca = notas.reduce((s, n) => s + Number(n.diferenca || 0), 0);

    await base44.asServiceRole.entities.AcertoCaixa.update(acerto_id, {
      notas,
      valor_total_recebido,
      valor_total_diferenca
    });

    return Response.json({ sucesso: true, alteradas, total: notas.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});