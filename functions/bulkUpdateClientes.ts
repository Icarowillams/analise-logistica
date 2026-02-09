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

    console.log(`Iniciando atualização de ${clientes.length} clientes...`);

    let atualizados = 0;
    let erros = [];

    // Atualizar um por um com delay para evitar rate limit
    for (let i = 0; i < clientes.length; i++) {
      const cliente = clientes[i];
      try {
        await base44.asServiceRole.entities.Cliente.update(cliente.id, cliente.data);
        atualizados++;
        
        // Log de progresso a cada 20 clientes
        if ((i + 1) % 20 === 0) {
          console.log(`Progresso: ${i + 1}/${clientes.length} clientes atualizados`);
        }
        
        // Delay de 50ms entre cada atualização
        if (i < clientes.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        console.error(`Erro ao atualizar cliente ${cliente.id}:`, error.message);
        erros.push({ id: cliente.id, error: error.message });
      }
    }

    console.log(`Atualização concluída: ${atualizados} atualizados, ${erros.length} erros`);

    return Response.json({
      success: true,
      atualizados,
      erros: erros.length,
      detalhesErros: erros
    });
  } catch (error) {
    console.error('Erro geral:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});