import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { offset = 0, limit = 50 } = await req.json().catch(() => ({}));

    // Buscar clientes com paginação
    const todosClientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
    const total = todosClientes.length;
    
    // Filtrar apenas os que têm inscricao_estadual ou estado preenchidos
    const clientesComDados = todosClientes.filter(c => 
      (c.inscricao_estadual && c.inscricao_estadual.trim() !== '') || 
      (c.estado && c.estado.trim() !== '')
    );
    
    const totalComDados = clientesComDados.length;
    const lote = clientesComDados.slice(offset, offset + limit);
    
    console.log(`Total clientes: ${total}, Com dados para limpar: ${totalComDados}, Processando offset ${offset}, lote de ${lote.length}`);

    if (lote.length === 0) {
      return Response.json({ 
        concluido: true,
        total,
        totalComDados,
        mensagem: 'Nenhum cliente restante para processar neste offset'
      });
    }

    let atualizados = 0;
    let erros = 0;
    const detalhesErros = [];

    // Processar UM por vez com delay grande entre cada
    for (const cliente of lote) {
      let sucesso = false;
      for (let tentativa = 1; tentativa <= 5; tentativa++) {
        try {
          await base44.asServiceRole.entities.Cliente.update(cliente.id, {
            inscricao_estadual: '',
            estado: ''
          });
          sucesso = true;
          atualizados++;
          break;
        } catch (err) {
          console.log(`Retry ${tentativa}/5 cliente ${cliente.id}: ${err.message}`);
          // Delay crescente: 2s, 4s, 8s, 16s, 32s
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, tentativa - 1)));
        }
      }
      if (!sucesso) {
        erros++;
        detalhesErros.push({ id: cliente.id, codigo: cliente.codigo });
      }
      
      // Delay de 1 segundo entre cada cliente
      await new Promise(r => setTimeout(r, 1000));
    }

    const proximoOffset = offset + limit;
    const temMais = proximoOffset < totalComDados;

    console.log(`Lote concluído: ${atualizados} atualizados, ${erros} erros. Tem mais: ${temMais}`);

    return Response.json({ 
      concluido: !temMais,
      total,
      totalComDados,
      processados: lote.length,
      atualizados, 
      erros,
      detalhesErros,
      proximoOffset: temMais ? proximoOffset : null
    });
  } catch (error) {
    console.error('Erro:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});