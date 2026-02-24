import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Buscar todos os clientes
    const clientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
    console.log(`Total de clientes encontrados: ${clientes.length}`);

    let atualizados = 0;
    let erros = 0;

    // Processar em lotes de 5 com retry
    const BATCH = 5;
    for (let i = 0; i < clientes.length; i += BATCH) {
      const batch = clientes.slice(i, i + BATCH);
      
      const results = await Promise.all(batch.map(async (cliente) => {
        for (let t = 1; t <= 5; t++) {
          try {
            await base44.asServiceRole.entities.Cliente.update(cliente.id, {
              inscricao_estadual: '',
              estado: ''
            });
            return true;
          } catch (err) {
            if (t === 5) {
              console.error(`Falha cliente ${cliente.id}: ${err.message}`);
              return false;
            }
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, t)));
          }
        }
      }));

      atualizados += results.filter(r => r).length;
      erros += results.filter(r => !r).length;

      if (i + BATCH < clientes.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    console.log(`Concluído: ${atualizados} atualizados, ${erros} erros`);

    return Response.json({ 
      total: clientes.length, 
      atualizados, 
      erros 
    });
  } catch (error) {
    console.error('Erro:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});