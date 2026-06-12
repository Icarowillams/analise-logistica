import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Adiciona clientes (por codigo_interno) ao roteiro de um vendedor em dias específicos.
// Para cada dia: usa o roteiro existente do vendedor naquele dia (NÃO duplica roteiro)
// ou cria um único se não existir. Dentro de cada roteiro, ignora clientes já presentes.
//
// Body: { vendedor_id: string, codigos_clientes: string[], dias: string[] }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Apenas admins' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const vendedorId = body.vendedor_id || '';
    const codigosClientes = (body.codigos_clientes || []).map(String);
    const dias = body.dias || [];

    if (!vendedorId) return Response.json({ error: 'vendedor_id obrigatório' }, { status: 400 });
    if (!codigosClientes.length) return Response.json({ error: 'codigos_clientes obrigatório' }, { status: 400 });
    if (!dias.length) return Response.json({ error: 'dias obrigatório' }, { status: 400 });

    const vendedor = await base44.asServiceRole.entities.Vendedor.get(vendedorId);
    if (!vendedor) return Response.json({ error: 'Vendedor não encontrado' }, { status: 404 });

    // Localizar clientes pelo codigo_interno
    const todosClientes = await base44.asServiceRole.entities.Cliente.list();
    const clientesAlvo = todosClientes.filter(c =>
      codigosClientes.includes(String(c.codigo_interno || '')) ||
      codigosClientes.includes(String(c.codigo_integracao || ''))
    );
    if (!clientesAlvo.length) {
      return Response.json({ error: `Nenhum cliente encontrado para: ${codigosClientes.join(', ')}` }, { status: 404 });
    }

    // Roteiros do vendedor
    const roteirosList = await base44.asServiceRole.entities.Roteiro.list();
    const roteirosDoVendedor = roteirosList.filter(r => r.vendedor_id === vendedorId);

    const resultado = [];

    for (const dia of dias) {
      let roteiro = roteirosDoVendedor.find(r => r.dia_semana === dia);

      if (!roteiro) {
        roteiro = await base44.asServiceRole.entities.Roteiro.create({
          vendedor_id: vendedorId,
          vendedor_nome: vendedor.nome || '',
          dia_semana: dia,
          clientes_ids: [],
          clientes_detalhes: [],
          status: 'ativo',
          ativo: true
        });
        roteirosDoVendedor.push(roteiro);
      }

      const idsAtuais = roteiro.clientes_ids || [];
      const detalhesAtuais = roteiro.clientes_detalhes || [];
      const idsSet = new Set(idsAtuais);

      const novos = clientesAlvo.filter(c => !idsSet.has(c.id));

      if (!novos.length) {
        resultado.push({ dia, roteiro_id: roteiro.id, adicionados: 0, ja_presentes: clientesAlvo.length });
        continue;
      }

      const novosIds = novos.map(c => c.id);
      const novosDetalhes = novos.map((c, i) => ({
        cliente_id: c.id,
        cliente_nome: c.razao_social || '',
        nome_fantasia: c.nome_fantasia || '',
        cliente_codigo: String(c.codigo_interno || ''),
        cliente_cidade: c.cidade || '',
        cliente_bairro: c.bairro || '',
        cliente_endereco: c.endereco || '',
        cliente_telefone: c.telefone || '',
        ordem: idsAtuais.length + i + 1
      }));

      await base44.asServiceRole.entities.Roteiro.update(roteiro.id, {
        clientes_ids: [...idsAtuais, ...novosIds],
        clientes_detalhes: [...detalhesAtuais, ...novosDetalhes]
      });

      resultado.push({
        dia,
        roteiro_id: roteiro.id,
        adicionados: novos.length,
        clientes: novos.map(c => ({ codigo: c.codigo_interno, nome: c.razao_social }))
      });
    }

    return Response.json({
      sucesso: true,
      vendedor: { id: vendedor.id, nome: vendedor.nome },
      resultado
    });
  } catch (error) {
    console.error('[adicionarClientesRoteiroDias] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});