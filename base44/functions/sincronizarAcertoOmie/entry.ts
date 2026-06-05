import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function consultarPedido(base44, codigoPedido, tentativa = 1) {
  // Usa credenciais do banco (ConfiguracaoOmie) com fallback para env
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  const OMIE_KEY = (ativo?.app_key ? String(ativo.app_key) : null) || Deno.env.get('OMIE_APP_KEY') || Deno.env.get('OMIE_API_KEY');
  const OMIE_SECRET = (ativo?.app_secret ? String(ativo.app_secret) : null) || Deno.env.get('OMIE_APP_SECRET') || Deno.env.get('OMIE_API_SECRET');

  const res = await fetch('https://app.omie.com.br/api/v1/produtos/pedido/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarPedido',
      app_key: OMIE_KEY,
      app_secret: OMIE_SECRET,
      param: [{ codigo_pedido: Number(codigoPedido) }]
    })
  });
  const data = await res.json().catch(() => ({}));
  const fs = String(data?.faultstring || '').toLowerCase();
  const transient = fs.includes('cota') || fs.includes('aguarde') || fs.includes('limite de requisi') || res.status === 429;
  if (transient && tentativa < 4) {
    await new Promise(r => setTimeout(r, 3000 * tentativa));
    return consultarPedido(base44, codigoPedido, tentativa + 1);
  }
  return data;
}

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

      const data = await consultarPedido(base44, nota.codigo_pedido);
      const fs = (data?.faultstring || '').toLowerCase();
      const ped = data?.pedido_venda_produto || {};
      const etapa = ped?.cabecalho?.etapa || '';
      const numeroNfRet = ped?.informacoes_adicionais?.numero_pedido_cliente || '';
      const isCancelado = fs.includes('cancelad') || fs.includes('excluíd') || fs.includes('excluid') || etapa === '99' || etapa === 'cancelado';

      if (isCancelado) {
        nota.status_entrega = 'nao_entregue';
        nota.valor_recebido = 0;
        nota.diferenca = -Number(nota.valor_original || 0);
        nota.motivo_cancelamento = 'Cancelada no Omie';
        if (!nota.numero_nfe && numeroNfRet) nota.numero_nfe = String(numeroNfRet);
        alteradas++;
      }
    }

    // Recalcula totais
    const valor_total_recebido = notas.reduce((s, n) => s + Number(n.valor_recebido || 0), 0);
    const valor_total_diferenca = notas.reduce((s, n) => s + Number(n.diferenca || 0), 0);

    const updates = {
      notas,
      valor_total_recebido,
      valor_total_diferenca
    };

    // 🐛 FIX: Carga.status_carga só aceita 'montagem' ou 'faturada' (enum binário).
    // O valor 'cancelada' NUNCA existirá na entidade — a condição anterior era código morto.
    // Agora detectamos cancelamento real verificando se TODAS as notas foram canceladas no Omie.
    let autoFinalizado = false;
    if (acerto.status_acerto === 'em_andamento') {
      const totalNotas = notas.length;
      const notasCanceladas = notas.filter(n =>
        n.status_entrega === 'nao_entregue' &&
        (n.motivo_cancelamento || '').toLowerCase().includes('cancelada no omie')
      ).length;

      // Auto-finaliza se: todas as notas foram canceladas no Omie OU não há notas (carga vazia)
      if (totalNotas > 0 && notasCanceladas === totalNotas) {
        updates.status_acerto = 'finalizado';
        updates.finalizado_em = new Date().toISOString();
        updates.finalizado_por = 'auto-sync (todas as notas canceladas no Omie)';
        autoFinalizado = true;
      }
    }

    await base44.asServiceRole.entities.AcertoCaixa.update(acerto_id, updates);

    return Response.json({ sucesso: true, alteradas, total: notas.length, autoFinalizado });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
