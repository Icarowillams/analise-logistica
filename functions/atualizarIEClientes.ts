import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { updates } = await req.json();
    
    if (!updates || !Array.isArray(updates)) {
      return Response.json({ error: 'updates array required' }, { status: 400 });
    }

    // Buscar todos os clientes
    const clientes = await base44.asServiceRole.entities.Cliente.filter({});
    
    // Criar mapa por código
    const clientesPorCodigo = {};
    clientes.forEach(c => {
      if (c.codigo) clientesPorCodigo[c.codigo] = c;
    });

    let atualizados = 0;
    let naoEncontrados = [];

    for (const upd of updates) {
      const cliente = clientesPorCodigo[upd.codigo];
      if (cliente) {
        await base44.asServiceRole.entities.Cliente.update(cliente.id, {
          inscricao_estadual: upd.inscricao_estadual || '',
          estado: upd.estado || ''
        });
        atualizados++;
      } else {
        naoEncontrados.push(upd.codigo);
      }
    }

    return Response.json({ 
      success: true, 
      atualizados, 
      naoEncontrados,
      total: updates.length 
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});