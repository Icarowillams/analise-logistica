import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 🧹 LIMPEZA DE BACKLOG: pedidos cancelados/excluídos/devolvidos no Omie que ficaram
// "fantasma" — com data_cancelamento gravada mas status ainda ATIVO
// (pendente/liberado/montagem/faturado). Aplica a MESMA regra de segurança do webhook,
// usando APENAS dados LOCAIS (nunca consulta o Omie em massa → sem rate limit).
//
//   - Pré-faturamento (sem NF/faturamento) → status='cancelado'
//   - Já faturado (status='faturado' OU tem NF/data_faturamento) → 'cancelado_pos_faturamento'
//     + cancelado_no_omie=true (preserva rastreabilidade financeira)
//
// Idempotente: pedidos já em 'cancelado'/'cancelado_pos_faturamento' são ignorados.
// Admin-only.

const STATUS_ATIVOS = ['pendente', 'enviado', 'liberado', 'montagem', 'faturado'];

function ehFaturado(p) {
  return p.status === 'faturado'
    || p.faturado === true
    || !!p.numero_nota_fiscal
    || !!p.data_faturamento;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = await req.json().catch(() => ({}));
    const dryRun = payload?.dry_run === true;

    // Busca pedidos com cancelamento gravado mas status ainda ativo.
    // Filtramos por cada status ativo (filter por chave, nunca list total) e cruzamos
    // com data_cancelamento preenchida em memória.
    const lotes = await Promise.all(
      STATUS_ATIVOS.map(s =>
        base44.asServiceRole.entities.Pedido.filter({ status: s }, '-created_date', 2000).catch(() => [])
      )
    );
    const candidatos = lotes.flat().filter(p => !!p.data_cancelamento);

    let preFaturamento = 0;
    let posFaturamento = 0;
    const detalhes = [];

    for (const p of candidatos) {
      const jaFaturado = ehFaturado(p);
      const novoStatus = jaFaturado ? 'cancelado_pos_faturamento' : 'cancelado';
      detalhes.push({
        pedido_id: p.id,
        numero_pedido: p.numero_pedido || '',
        status_anterior: p.status,
        novo_status: novoStatus,
        tem_nf: !!p.numero_nota_fiscal
      });
      if (jaFaturado) posFaturamento++; else preFaturamento++;

      if (!dryRun) {
        await base44.asServiceRole.entities.Pedido.update(p.id, {
          status: novoStatus,
          cancelado_no_omie: true
        }).catch((e) => console.error(`[sincronizarPedidosCancelados] erro pedido ${p.id}:`, e.message));
      }
    }

    if (!dryRun && candidatos.length > 0) {
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'sincronizarPedidosCancelados',
        call: 'sincronizar_pedidos_cancelados',
        operacao: 'limpeza_backlog_cancelados',
        status: 'sucesso',
        mensagem_erro: null,
        usuario_email: user.email,
        payload_resposta: JSON.stringify({
          total: candidatos.length, pre_faturamento: preFaturamento, pos_faturamento: posFaturamento
        }).slice(0, 2000)
      }).catch(() => {});
    }

    return Response.json({
      sucesso: true,
      dry_run: dryRun,
      total_corrigidos: candidatos.length,
      pre_faturamento: preFaturamento,
      pos_faturamento: posFaturamento,
      detalhes: detalhes.slice(0, 100)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});