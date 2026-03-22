import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Buscar todas as trocas
        const trocas = await base44.asServiceRole.entities.Troca.list('-created_date', 10000);
        
        // Buscar todas as vendas para fazer lookup
        const vendas = await base44.asServiceRole.entities.Venda.list('-created_date', 10000);
        
        let atualizados = 0;
        let erros = 0;
        
        // Processar em lotes
        const BATCH_SIZE = 20;
        
        for (let i = 0; i < trocas.length; i += BATCH_SIZE) {
            const batch = trocas.slice(i, i + BATCH_SIZE);
            
            const updates = batch.map(async (troca) => {
                try {
                    // Se já tem valor_unitario, pular
                    if (troca.valor_unitario && troca.valor_unitario > 0) {
                        return { success: true, skipped: true };
                    }
                    
                    // Tentar encontrar a venda correspondente
                    let venda = null;
                    
                    // 1. Tentar por venda_original_id
                    if (troca.venda_original_id) {
                        venda = vendas.find(v => v.id === troca.venda_original_id);
                    }
                    
                    // 2. Tentar extrair número do pedido das observações
                    if (!venda && troca.observacoes) {
                        const match = troca.observacoes.match(/Pedido:\s*(\S+)/);
                        if (match) {
                            const numPedido = match[1];
                            venda = vendas.find(v => 
                                v.numero_pedido === numPedido && 
                                v.produto_id === troca.produto_original_id
                            );
                        }
                    }
                    
                    // 3. Tentar buscar por cliente + produto + data próxima
                    if (!venda && troca.cliente_id && troca.produto_original_id && troca.data) {
                        venda = vendas.find(v => 
                            v.cliente_id === troca.cliente_id &&
                            v.produto_id === troca.produto_original_id &&
                            Math.abs(new Date(v.data) - new Date(troca.data)) < 7 * 24 * 60 * 60 * 1000 // 7 dias
                        );
                    }
                    
                    if (venda && venda.valor_unitario) {
                        await base44.asServiceRole.entities.Troca.update(troca.id, {
                            valor_unitario: venda.valor_unitario
                        });
                        return { success: true, updated: true };
                    }
                    
                    return { success: true, notFound: true };
                } catch (error) {
                    console.error(`Erro ao atualizar troca ${troca.id}:`, error);
                    return { success: false, error: error.message };
                }
            });
            
            const results = await Promise.all(updates);
            
            results.forEach(r => {
                if (r.success && r.updated) atualizados++;
                if (!r.success) erros++;
            });
            
            // Delay entre lotes para evitar sobrecarga
            if (i + BATCH_SIZE < trocas.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        return Response.json({
            success: true,
            message: `Processo concluído`,
            atualizados,
            erros,
            total: trocas.length
        });
        
    } catch (error) {
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});