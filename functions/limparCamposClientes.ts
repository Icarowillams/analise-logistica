import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { clienteIds = [] } = await req.json().catch(() => ({}));

    if (!clienteIds.length) {
      return Response.json({ error: 'Nenhum ID fornecido' }, { status: 400 });
    }

    console.log(`Processando ${clienteIds.length} clientes`);

    let atualizados = 0;
    let erros = 0;
    const detalhesErros = [];

    // Processar UM por vez com delay de 3s entre cada
    for (const id of clienteIds) {
      let sucesso = false;
      for (let t = 1; t <= 7; t++) {
        try {
          await base44.asServiceRole.entities.Cliente.update(id, {
            inscricao_estadual: '',
            estado: ''
          });
          sucesso = true;
          atualizados++;
          break;
        } catch (err) {
          // Delay crescente: 3s, 6s, 12s, 24s, 48s, 96s, 192s
          const delay = 3000 * Math.pow(2, t - 1);
          console.log(`Retry ${t}/7 cliente ${id} - aguardando ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
      if (!sucesso) {
        erros++;
        detalhesErros.push(id);
      }
      // 3 segundos entre cada cliente
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log(`Concluído: ${atualizados} ok, ${erros} erros`);

    return Response.json({ atualizados, erros, detalhesErros });
  } catch (error) {
    console.error('Erro:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});