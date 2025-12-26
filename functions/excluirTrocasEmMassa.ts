import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { ids } = await req.json();
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return Response.json({ error: 'IDs inválidos' }, { status: 400 });
    }

    // Excluir em lotes para evitar rate limit
    const BATCH_SIZE = 50;
    const DELAY_MS = 1000;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    let deletedCount = 0;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      
      try {
        await Promise.all(
          batch.map(id => base44.asServiceRole.entities.Troca.delete(id))
        );
        deletedCount += batch.length;
      } catch (batchError) {
        console.error(`Erro ao excluir lote (índice ${i}):`, batchError.message);
      }

      if (i + BATCH_SIZE < ids.length) {
        await sleep(DELAY_MS);
      }
    }

    return Response.json({ 
      success: true, 
      deletedCount 
    });
  } catch (error) {
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});