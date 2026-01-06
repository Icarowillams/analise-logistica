import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso negado. Apenas administradores.' }, { status: 403 });
    }

    // Buscar todas as trocas
    const trocas = await base44.asServiceRole.entities.Troca.list('-data', 10000);
    
    // Buscar todas as vendas
    const vendas = await base44.asServiceRole.entities.Venda.list('-data', 50000);
    
    let atualizados = 0;
    let semValor = 0;
    
    for (const troca of trocas) {
      // Se já tem valor_unitario, pular
      if (troca.valor_unitario && troca.valor_unitario > 0) {
        continue;
      }
      
      // Buscar vendas relacionadas (mesmo produto, mesmo cliente, período de 30 dias)
      const vendasRelacionadas = vendas.filter(v => 
        v.produto_id === troca.produto_original_id && 
        v.cliente_id === troca.cliente_id &&
        Math.abs(new Date(v.data) - new Date(troca.data)) < 30 * 24 * 60 * 60 * 1000
      );
      
      if (vendasRelacionadas.length > 0) {
        // Ordenar por data mais recente
        vendasRelacionadas.sort((a, b) => new Date(b.data) - new Date(a.data));
        const valorUnit = vendasRelacionadas[0]?.valor_unitario || 0;
        
        if (valorUnit > 0) {
          await base44.asServiceRole.entities.Troca.update(troca.id, {
            valor_unitario: valorUnit
          });
          atualizados++;
        } else {
          semValor++;
        }
      } else {
        semValor++;
      }
      
      // Delay para evitar sobrecarga
      if (atualizados % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return Response.json({
      success: true,
      total_trocas: trocas.length,
      atualizados,
      sem_valor: semValor
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});