import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Enfileira emissão de NF-e em lote para processamento assíncrono.
// A emissão real é feita pela função processarEmissaoNFLote, uma NF por vez,
// com delay seguro entre chamadas para evitar bloqueio da API Omie.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const codigosPedido = Array.isArray(body.codigos_pedido)
      ? body.codigos_pedido.map(c => String(c)).filter(Boolean)
      : [];

    if (codigosPedido.length === 0) {
      return Response.json({ error: 'codigos_pedido vazio' }, { status: 400 });
    }

    const loteId = `LOTE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fila = await base44.asServiceRole.entities.FilaEmissaoNF.create({
      tipo: 'emissao_nf_lote',
      lote_id: loteId,
      carga_id: body.carga_id || '',
      numero_carga: body.numero_carga || '',
      total_pedidos: codigosPedido.length,
      processados: 0,
      status: 'processando',
      pedidos: codigosPedido,
      resultados: [],
      erros: [],
      mensagem: 'Faturamento iniciado em background. Acompanhe o progresso na tela.',
      usuario_email: user.email,
      iniciado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    });

    return Response.json({
      sucesso: true,
      assincrono: true,
      fila_id: fila.id,
      lote_id: loteId,
      status: 'processando',
      total: codigosPedido.length,
      mensagem: 'Faturamento iniciado em background. Acompanhe o progresso na tela.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});