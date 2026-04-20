import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const simulacao = body.simulacao === true;
    const tipoPadrao = body.tipo_padrao || '55';

    // Buscar todos os clientes
    const todos = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);

    // Filtrar os sem tipo_nota
    const semTipo = todos.filter(c => !c.tipo_nota || c.tipo_nota === '');

    console.log(`Total clientes: ${todos.length} | Sem tipo_nota: ${semTipo.length}`);

    if (simulacao) {
      return Response.json({
        simulacao: true,
        total_clientes: todos.length,
        sem_tipo_nota: semTipo.length,
        serao_atualizados_para: tipoPadrao,
        amostra: semTipo.slice(0, 5).map(c => ({
          id: c.id,
          codigo: c.codigo_interno,
          razao_social: c.razao_social,
          tipo_nota_atual: c.tipo_nota || '(vazio)'
        }))
      });
    }

    // Atualizar em lotes com retry
    let atualizados = 0;
    let erros = 0;
    const detalhesErros = [];
    const BATCH = 20;

    for (let i = 0; i < semTipo.length; i += BATCH) {
      const lote = semTipo.slice(i, i + BATCH);
      
      await Promise.all(lote.map(async (c) => {
        let tentativa = 0;
        while (tentativa < 4) {
          try {
            await base44.asServiceRole.entities.Cliente.update(c.id, { tipo_nota: tipoPadrao });
            atualizados++;
            return;
          } catch (err) {
            tentativa++;
            if (tentativa >= 4) {
              erros++;
              detalhesErros.push({ id: c.id, codigo: c.codigo_interno, erro: err.message });
              return;
            }
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, tentativa)));
          }
        }
      }));

      // Delay entre lotes
      if (i + BATCH < semTipo.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return Response.json({
      sucesso: true,
      total_processados: semTipo.length,
      atualizados,
      erros,
      tipo_aplicado: tipoPadrao,
      amostra_erros: detalhesErros.slice(0, 5)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});