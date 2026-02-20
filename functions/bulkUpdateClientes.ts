import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clientes } = await req.json();

    if (!clientes || !Array.isArray(clientes) || clientes.length === 0) {
      return Response.json({ error: 'Nenhum cliente fornecido' }, { status: 400 });
    }

    console.log(`Processando lote de ${clientes.length} clientes`);

    let atualizados = 0;
    const erros = [];

    // Processar sequencialmente em pequenos grupos de 5 para evitar timeout
    const CONCURRENCY = 5;
    for (let i = 0; i < clientes.length; i += CONCURRENCY) {
      const chunk = clientes.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (cliente) => {
          try {
            await base44.asServiceRole.entities.Cliente.update(cliente.id, cliente.data);
          } catch (err) {
            // Retry once on failure
            await new Promise(r => setTimeout(r, 500));
            await base44.asServiceRole.entities.Cliente.update(cliente.id, cliente.data);
          }
        })
      );
      
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          atualizados++;
        } else {
          const cliente = chunk[idx];
          console.error(`Erro cliente ${cliente.id}:`, result.reason?.message);
          erros.push({ id: cliente.id, error: result.reason?.message });
        }
      });
    }

    console.log(`Concluído: ${atualizados} atualizados, ${erros.length} erros`);

    return Response.json({
      atualizados,
      erros: erros.length,
      detalhesErros: erros
    });
  } catch (error) {
    console.error('Erro geral:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});