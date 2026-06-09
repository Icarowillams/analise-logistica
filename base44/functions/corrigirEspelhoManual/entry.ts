import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Apenas admins podem executar correção manual' }, { status: 403 });

    // Busca todos os registros do espelho que NÃO estão na etapa 20 (liberado)
    const candidatos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
      {}, '-updated_date', 500
    ).catch(() => []);

    const espelhosForaDeEtapa = candidatos.filter(e => String(e.etapa || '') !== '20');

    if (espelhosForaDeEtapa.length === 0) {
      return Response.json({ sucesso: true, corrigidos: 0, registros: [], mensagem: 'Nenhum espelho fora da etapa 20 encontrado' });
    }

    // Para cada espelho fora de etapa, verifica se o Pedido correspondente tem status 'liberado'
    const corrigidos = [];

    for (const esp of espelhosForaDeEtapa) {
      const codigoPedido = String(esp.codigo_pedido || '');
      if (!codigoPedido) continue;

      const pedidos = await base44.asServiceRole.entities.Pedido.filter(
        { omie_codigo_pedido: codigoPedido, status: 'liberado' }, '-created_date', 1
      ).catch(() => []);

      if (pedidos.length === 0) continue;

      const pedido = pedidos[0];
      const etapaAnterior = esp.etapa;

      await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
        etapa: '20',
        sincronizado_em: new Date().toISOString(),
        origem_sync: 'correcao_manual'
      });

      console.log(`[corrigirEspelhoManual] Espelho ${codigoPedido} (pedido ${pedido.numero_pedido}) corrigido: etapa ${etapaAnterior} → 20`);

      corrigidos.push({
        espelho_id: esp.id,
        codigo_pedido: codigoPedido,
        pedido_id: pedido.id,
        numero_pedido: pedido.numero_pedido || '',
        etapa_anterior: etapaAnterior,
        etapa_nova: '20'
      });
    }

    return Response.json({
      sucesso: true,
      corrigidos: corrigidos.length,
      registros: corrigidos
    });
  } catch (error) {
    console.error('[corrigirEspelhoManual] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
