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

    // Função de update com retry agressivo (até 7 tentativas com backoff exponencial)
    const updateComRetry = async (cliente) => {
      let lastError = null;
      for (let tentativa = 1; tentativa <= 7; tentativa++) {
        try {
          await base44.asServiceRole.entities.Cliente.update(cliente.id, cliente.data);
          return { success: true, id: cliente.id };
        } catch (err) {
          lastError = err;
          // Backoff exponencial: 500ms, 1s, 2s, 4s, 8s, 16s, 32s
          const delay = Math.min(500 * Math.pow(2, tentativa - 1), 32000);
          console.log(`Retry ${tentativa}/7 cliente ${cliente.id} (aguardando ${delay}ms): ${err.message}`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
      return { success: false, id: cliente.id, error: lastError?.message || 'Erro desconhecido' };
    };

    // Processar sequencialmente em grupos pequenos de 3 para minimizar rate limit
    const CONCURRENCY = 3;
    let resultados = [];

    for (let i = 0; i < clientes.length; i += CONCURRENCY) {
      const chunk = clientes.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(c => updateComRetry(c)));
      resultados.push(...results);
      
      // Delay entre chunks
      if (i + CONCURRENCY < clientes.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Separar sucessos e falhas
    let atualizados = resultados.filter(r => r.success).length;
    let falhas = resultados.filter(r => !r.success);

    // SEGUNDA RODADA: reprocessar todos que falharam, um por um, com delay maior
    if (falhas.length > 0) {
      console.log(`Segunda rodada: reprocessando ${falhas.length} clientes que falharam`);
      const clientesParaReprocessar = clientes.filter(c => falhas.some(f => f.id === c.id));
      
      for (const cliente of clientesParaReprocessar) {
        // Esperar 2 segundos entre cada um para evitar qualquer rate limit
        await new Promise(r => setTimeout(r, 2000));
        const result = await updateComRetry(cliente);
        if (result.success) {
          atualizados++;
          falhas = falhas.filter(f => f.id !== cliente.id);
        }
      }
    }

    // TERCEIRA RODADA: última tentativa para os restantes, um por um, delay de 5s
    if (falhas.length > 0) {
      console.log(`Terceira rodada: ${falhas.length} clientes restantes`);
      const clientesRestantes = clientes.filter(c => falhas.some(f => f.id === c.id));
      
      for (const cliente of clientesRestantes) {
        await new Promise(r => setTimeout(r, 5000));
        const result = await updateComRetry(cliente);
        if (result.success) {
          atualizados++;
          falhas = falhas.filter(f => f.id !== cliente.id);
        }
      }
    }

    const errosFinais = falhas.map(f => ({ id: f.id, error: f.error }));
    console.log(`Concluído: ${atualizados} atualizados, ${errosFinais.length} erros definitivos`);
    if (errosFinais.length > 0) {
      console.log('Erros finais:', JSON.stringify(errosFinais));
    }

    return Response.json({
      atualizados,
      erros: errosFinais.length,
      detalhesErros: errosFinais
    });
  } catch (error) {
    console.error('Erro geral:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});