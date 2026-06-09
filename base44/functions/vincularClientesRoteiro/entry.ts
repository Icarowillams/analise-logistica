import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Vincula clientes (por codigo_interno) ao roteiro de um vendedor (por nome).
// Se o vendedor não tiver nenhum roteiro, cria um para segunda-feira.
// Idempotente: clientes já presentes em qualquer roteiro do vendedor são ignorados.
//
// Body: { vendedor_nome: string, codigos_clientes: string[] }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Apenas admins' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const vendedorNome: string = body.vendedor_nome || '';
    const codigosClientes: string[] = (body.codigos_clientes || []).map(String);

    if (!vendedorNome) return Response.json({ error: 'vendedor_nome obrigatório' }, { status: 400 });
    if (!codigosClientes.length) return Response.json({ error: 'codigos_clientes obrigatório' }, { status: 400 });

    // 1. Localizar vendedor pelo nome (busca parcial, case-insensitive)
    const todosVendedores = await base44.asServiceRole.entities.Vendedor.list();
    const nomeNorm = vendedorNome.trim().toLowerCase();
    const vendedor = todosVendedores.find(v =>
      v.nome?.toLowerCase().includes(nomeNorm) ||
      v.nome_completo?.toLowerCase().includes(nomeNorm)
    );
    if (!vendedor) {
      return Response.json({ error: `Vendedor '${vendedorNome}' não encontrado` }, { status: 404 });
    }

    // 2. Localizar clientes pelo codigo_interno
    const todosClientes = await base44.asServiceRole.entities.Cliente.list();
    const clientesAlvo = todosClientes.filter(c =>
      codigosClientes.includes(String(c.codigo_interno || '')) ||
      codigosClientes.includes(String(c.codigo || ''))
    );
    if (!clientesAlvo.length) {
      return Response.json({ error: `Nenhum cliente encontrado para os códigos: ${codigosClientes.join(', ')}` }, { status: 404 });
    }

    const clientesNaoEncontrados = codigosClientes.filter(cod =>
      !clientesAlvo.some(c => String(c.codigo_interno || '') === cod || String(c.codigo || '') === cod)
    );

    // 3. Buscar todos os roteiros do vendedor
    const roteirosList = await base44.asServiceRole.entities.Roteiro.list();
    const roteirosDoVendedor = roteirosList.filter(r => r.vendedor_id === vendedor.id);

    // 4. IDs que já estão em algum roteiro do vendedor (idempotência)
    const idsJaVinculados = new Set<string>();
    roteirosDoVendedor.forEach(r => {
      (r.clientes_ids || []).forEach(id => idsJaVinculados.add(id));
    });

    const clientesParaAdicionar = clientesAlvo.filter(c => !idsJaVinculados.has(c.id));

    if (!clientesParaAdicionar.length) {
      return Response.json({
        sucesso: true,
        vendedor: { id: vendedor.id, nome: vendedor.nome },
        mensagem: 'Todos os clientes já estão vinculados a algum roteiro do vendedor',
        clientes_ja_vinculados: clientesAlvo.map(c => ({ id: c.id, codigo_interno: c.codigo_interno, nome: c.razao_social })),
        clientes_nao_encontrados: clientesNaoEncontrados
      });
    }

    // 5. Usar primeiro roteiro existente ou criar um novo
    let roteiro = roteirosDoVendedor.find(r => r.ativo !== false) || roteirosDoVendedor[0] || null;

    if (!roteiro) {
      roteiro = await base44.asServiceRole.entities.Roteiro.create({
        vendedor_id: vendedor.id,
        vendedor_nome: vendedor.nome || '',
        dia_semana: 'segunda-feira',
        clientes_ids: [],
        clientes_detalhes: [],
        status: 'ativo',
        ativo: true
      });
      console.log(`[vincularClientesRoteiro] Roteiro criado para ${vendedor.nome}: ${roteiro.id}`);
    }

    // 6. Atualizar roteiro com os novos clientes
    const idsAtuais: string[] = roteiro.clientes_ids || [];
    const detalhesAtuais = roteiro.clientes_detalhes || [];

    const novosIds = clientesParaAdicionar.map(c => c.id);
    const novosDetalhes = clientesParaAdicionar.map((c, i) => ({
      cliente_id: c.id,
      cliente_nome: c.razao_social || c.nome || '',
      nome_fantasia: c.nome_fantasia || '',
      cliente_codigo: String(c.codigo_interno || c.codigo || ''),
      cliente_cidade: c.cidade || '',
      cliente_bairro: c.bairro || '',
      cliente_endereco: c.logradouro || '',
      cliente_telefone: c.telefone || '',
      ordem: idsAtuais.length + i + 1
    }));

    await base44.asServiceRole.entities.Roteiro.update(roteiro.id, {
      clientes_ids: [...idsAtuais, ...novosIds],
      clientes_detalhes: [...detalhesAtuais, ...novosDetalhes]
    });

    console.log(`[vincularClientesRoteiro] ${clientesParaAdicionar.length} cliente(s) adicionados ao roteiro ${roteiro.id} de ${vendedor.nome}`);

    return Response.json({
      sucesso: true,
      vendedor: { id: vendedor.id, nome: vendedor.nome },
      roteiro: { id: roteiro.id, dia_semana: roteiro.dia_semana, criado: !roteirosDoVendedor.length },
      clientes_adicionados: clientesParaAdicionar.map(c => ({
        id: c.id,
        codigo_interno: c.codigo_interno,
        nome: c.razao_social
      })),
      clientes_nao_encontrados: clientesNaoEncontrados
    });
  } catch (error) {
    console.error('[vincularClientesRoteiro] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
