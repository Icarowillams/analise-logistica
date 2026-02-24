import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { dados } = await req.json();
  if (!dados || !Array.isArray(dados)) {
    return Response.json({ error: 'dados array required' }, { status: 400 });
  }

  // Buscar todos os clientes
  const clientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
  
  // Criar mapa por codigo
  const clienteMap = {};
  for (const c of clientes) {
    if (c.codigo) {
      clienteMap[c.codigo] = c;
    }
  }

  let atualizados = 0;
  let naoEncontrados = [];

  // Processar sequencialmente com delay para evitar rate limit e timeout
  for (let i = 0; i < dados.length; i++) {
    const item = dados[i];
    const cliente = clienteMap[item.codigo];
    if (!cliente) {
      naoEncontrados.push(item.codigo);
      continue;
    }
    
    const updateData = {};
    if (item.inscricao_estadual !== undefined && item.inscricao_estadual !== null) {
      updateData.inscricao_estadual = item.inscricao_estadual;
    }
    if (item.estado && item.estado.length === 2) {
      updateData.estado = item.estado;
    }
    
    if (Object.keys(updateData).length > 0) {
      try {
        await base44.asServiceRole.entities.Cliente.update(cliente.id, updateData);
        atualizados++;
      } catch (e) {
        // Se rate limit, esperar e tentar de novo
        if (e.message?.includes('Rate limit') || e.message?.includes('429')) {
          await sleep(2000);
          try {
            await base44.asServiceRole.entities.Cliente.update(cliente.id, updateData);
            atualizados++;
          } catch (e2) {
            erros.push(item.codigo);
          }
        } else {
          erros.push(item.codigo);
        }
      }
      // Pequeno delay entre cada update
      if (i % 3 === 0) await sleep(200);
    }
  }

  return Response.json({ 
    atualizados, 
    total: dados.length,
    nao_encontrados: naoEncontrados.length,
    nao_encontrados_codigos: naoEncontrados.slice(0, 50)
  });
});