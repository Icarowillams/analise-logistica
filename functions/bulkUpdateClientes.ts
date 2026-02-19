import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clientes, lote_inicio = 0 } = await req.json();

    if (!clientes || !Array.isArray(clientes) || clientes.length === 0) {
      return Response.json({ error: 'Nenhum cliente fornecido' }, { status: 400 });
    }

    // Processar apenas 30 clientes por chamada para evitar timeout
    const LOTE_MAX = 30;
    const lote = clientes.slice(lote_inicio, lote_inicio + LOTE_MAX);

    if (lote.length === 0) {
      return Response.json({ 
        concluido: true,
        atualizados: 0,
        erros: 0,
        detalhesErros: []
      });
    }

    console.log(`Lote ${lote_inicio}: processando ${lote.length} de ${clientes.length} clientes`);

    let atualizados = 0;
    const erros = [];

    for (let i = 0; i < lote.length; i++) {
      const cliente = lote[i];
      try {
        await base44.asServiceRole.entities.Cliente.update(cliente.id, cliente.data);
        atualizados++;
      } catch (error) {
        console.error(`Erro ao atualizar cliente ${cliente.id}:`, error.message);
        erros.push({ id: cliente.id, error: error.message });
      }

      // Delay de 50ms entre cada atualização
      if (i < lote.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    const proximoLote = lote_inicio + LOTE_MAX;
    const concluido = proximoLote >= clientes.length;

    console.log(`Lote concluído: ${atualizados} atualizados, ${erros.length} erros. Concluído: ${concluido}`);

    return Response.json({
      concluido,
      proximo_lote: concluido ? null : proximoLote,
      total_geral: clientes.length,
      atualizados,
      erros: erros.length,
      detalhesErros: erros
    });
  } catch (error) {
    console.error('Erro geral:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});