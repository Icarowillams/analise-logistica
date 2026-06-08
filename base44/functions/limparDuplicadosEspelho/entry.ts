import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Carregar todo o espelho
    const todos = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('-created_date', 2000);

    // Agrupar por codigo_pedido
    const porCodigo = {};
    for (const reg of todos) {
      const cod = reg.codigo_pedido;
      if (!cod) continue;
      if (!porCodigo[cod]) porCodigo[cod] = [];
      porCodigo[cod].push(reg);
    }

    // Identificar duplicados (manter o mais recente, remover os outros)
    const paraRemover = [];
    const duplicadosEncontrados = [];

    for (const [cod, regs] of Object.entries(porCodigo)) {
      if (regs.length <= 1) continue;

      // Ordenar por updated_date desc — manter o primeiro (mais recente)
      regs.sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
      
      const mantido = regs[0];
      const removidos = regs.slice(1);

      duplicadosEncontrados.push({
        codigo_pedido: cod,
        numero_pedido: mantido.numero_pedido,
        nome_cliente: mantido.nome_cliente,
        total_registros: regs.length,
        mantido_id: mantido.id,
        removidos_ids: removidos.map(r => r.id)
      });

      for (const rem of removidos) {
        paraRemover.push(rem.id);
      }
    }

    // Modo dry-run por padrão
    const body = await req.json().catch(() => ({}));
    const executar = body.executar === true;

    if (executar && paraRemover.length > 0) {
      // Remover em lotes de 10
      for (let i = 0; i < paraRemover.length; i++) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.delete(paraRemover[i]);
      }
    }

    return Response.json({
      total_espelho: todos.length,
      duplicados_encontrados: duplicadosEncontrados.length,
      registros_para_remover: paraRemover.length,
      executado: executar,
      detalhes: duplicadosEncontrados
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});