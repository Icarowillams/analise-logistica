import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clientes } = await req.json();

    if (!clientes || !Array.isArray(clientes) || clientes.length === 0) {
      return Response.json({ error: 'clientes array é obrigatório' }, { status: 400 });
    }

    let atualizados = 0;
    const detalhesErros = [];

    // Preparar dados para bulkUpdate
    const updates = clientes.map(c => ({
      id: c.id,
      ...c.data
    }));

    // Processar em sub-lotes de 50 para evitar rate limits
    const SUB_BATCH = 50;
    for (let i = 0; i < updates.length; i += SUB_BATCH) {
      const batch = updates.slice(i, i + SUB_BATCH);
      
      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await base44.asServiceRole.entities.Cliente.bulkUpdate(batch);
          atualizados += batch.length;
          success = true;
          break;
        } catch (e) {
          const isRateLimit = e.message?.includes('Rate limit') || e.message?.includes('429');
          if (isRateLimit && attempt < 2) {
            const waitMs = 3000 * Math.pow(2, attempt);
            console.log(`[bulkUpdate] Rate limit sub-lote ${i}, tentativa ${attempt + 1}, aguardando ${waitMs}ms`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          
          // Fallback: atualizar individualmente
          console.log(`[bulkUpdate] Bulk falhou, tentando individual para ${batch.length} clientes`);
          for (const item of batch) {
            try {
              const { id, ...data } = item;
              await base44.asServiceRole.entities.Cliente.update(id, data);
              atualizados++;
              await new Promise(r => setTimeout(r, 100));
            } catch (itemErr) {
              detalhesErros.push({ id: item.id, error: itemErr.message });
            }
          }
          success = true;
          break;
        }
      }

      // Delay entre sub-lotes
      if (i + SUB_BATCH < updates.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return Response.json({
      sucesso: true,
      atualizados,
      erros: detalhesErros.length,
      detalhesErros,
      total: clientes.length
    });
  } catch (error) {
    console.error('[bulkUpdateClientes] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});