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

    // Processar 1 por vez com delay para evitar rate limit
    for (let i = 0; i < clientes.length; i++) {
      const cliente = clientes[i];
      let tentativas = 0;
      let sucesso = false;

      while (tentativas < 3 && !sucesso) {
        try {
          await base44.asServiceRole.entities.Cliente.update(cliente.id, cliente.data);
          atualizados++;
          sucesso = true;
        } catch (err) {
          tentativas++;
          if (err.message?.includes('429') || err.message?.includes('Rate limit')) {
            // Esperar mais tempo a cada tentativa
            const waitTime = tentativas * 2000;
            console.log(`Rate limit no cliente ${cliente.id}, aguardando ${waitTime}ms (tentativa ${tentativas})`);
            await new Promise(r => setTimeout(r, waitTime));
          } else if (tentativas >= 3) {
            console.error(`Erro cliente ${cliente.id} após ${tentativas} tentativas:`, err.message);
            erros.push({ id: cliente.id, error: err.message });
          } else {
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      if (!sucesso && tentativas >= 3) {
        // Já registrado nos erros acima via catch
        if (!erros.find(e => e.id === cliente.id)) {
          erros.push({ id: cliente.id, error: 'Falha após 3 tentativas' });
        }
      }

      // Delay entre cada cliente para evitar rate limit
      if (i < clientes.length - 1) {
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