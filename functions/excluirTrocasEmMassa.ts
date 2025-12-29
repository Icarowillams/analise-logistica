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

        const BATCH_SIZE = 5;
        const DELAY_MS = 2000;
        
        let deletados = 0;
        const erros = [];
        
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            const batch = ids.slice(i, i + BATCH_SIZE);
            
            try {
                await Promise.all(
                    batch.map(id => base44.asServiceRole.entities.Troca.delete(id))
                );
                deletados += batch.length;
            } catch (error) {
                erros.push({ lote: i, erro: error.message });
            }
            
            // Delay entre lotes
            if (i + BATCH_SIZE < ids.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        return Response.json({
            success: true,
            deletados,
            total: ids.length,
            erros
        });

    } catch (error) {
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});