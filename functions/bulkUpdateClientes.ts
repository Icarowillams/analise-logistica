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

    // Função de update com retry e backoff exponencial
    const updateComRetry = async (cliente, tentativa = 1) => {
      try {
        await base44.asServiceRole.entities.Cliente.update(cliente.id, cliente.data);
        return true;
      } catch (err) {
        const isRateLimit = err.message?.includes('rate') || err.message?.includes('429') || err.message?.includes('Too Many') || err.status === 429;
        if (tentativa <= 5) {
          // Backoff exponencial: 1s, 2s, 4s, 8s, 16s
          const delay = Math.min(1000 * Math.pow(2, tentativa - 1), 16000);
          console.log(`Retry ${tentativa}/5 para cliente ${cliente.id} (aguardando ${delay}ms)${isRateLimit ? ' [rate limit]' : ''}`);
          await new Promise(r => setTimeout(r, delay));
          return updateComRetry(cliente, tentativa + 1);
        }
        throw err;
      }
    };

    // Processar em chunks de 10 com concorrência controlada
    const CONCURRENCY = 10;
    for (let i = 0; i < clientes.length; i += CONCURRENCY) {
      const chunk = clientes.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(cliente => updateComRetry(cliente))
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

      // Pequeno delay entre chunks para não sobrecarregar
      if (i + CONCURRENCY < clientes.length) {
        await new Promise(r => setTimeout(r, 200));
      }
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