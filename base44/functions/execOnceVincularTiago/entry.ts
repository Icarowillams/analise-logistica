import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // 1. Localizar Tiago Leandro
    const todosVendedores = await base44.asServiceRole.entities.Vendedor.list();
    const vendedor = todosVendedores.find(v =>
      v.nome?.toLowerCase().includes('tiago leandro') ||
      v.nome_completo?.toLowerCase().includes('tiago leandro')
    );
    if (!vendedor) return Response.json({ sucesso: false, erro: 'Vendedor Tiago Leandro não encontrado' }, { status: 404 });

    // 2. Localizar clientes 28090 e 26569 pelo codigo_interno
    const todosClientes = await base44.asServiceRole.entities.Cliente.list();
    const CODIGOS = ['28090', '26569'];
    const clientesAlvo = todosClientes.filter(c =>
      CODIGOS.includes(String(c.codigo_interno || '')) || CODIGOS.includes(String(c.codigo || ''))
    );
    if (!clientesAlvo.length) return Response.json({ sucesso: false, erro: 'Nenhum cliente encontrado para 28090 / 26569' }, { status: 404 });

    // 3. IDs já vinculados a qualquer roteiro do Tiago
    const roteirosList = await base44.asServiceRole.entities.Roteiro.list();
    const roteirosDoVendedor = roteirosList.filter(r => r.vendedor_id === vendedor.id);
    const idsJaVinculados = new Set<string>();
    roteirosDoVendedor.forEach(r => (r.clientes_ids || []).forEach(id => idsJaVinculados.add(id)));

    const clientesParaAdicionar = clientesAlvo.filter(c => !idsJaVinculados.has(c.id));

    if (!clientesParaAdicionar.length) {
      return Response.json({
        sucesso: true,
        mensagem: 'Clientes já estavam vinculados a um roteiro de Tiago Leandro',
        vendedor: { id: vendedor.id, nome: vendedor.nome },
        clientes_ja_vinculados: clientesAlvo.map(c => ({ id: c.id, codigo_interno: c.codigo_interno, nome: c.razao_social }))
      });
    }

    // 4. Roteiro alvo: primeiro ativo existente ou cria novo
    let roteiro = roteirosDoVendedor.find(r => r.ativo !== false) || roteirosDoVendedor[0] || null;
    let roteiroCriado = false;
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
      roteiroCriado = true;
    }

    // 5. Atualizar roteiro
    const idsAtuais: string[] = roteiro.clientes_ids || [];
    const detalhesAtuais = roteiro.clientes_detalhes || [];
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
      clientes_ids: [...idsAtuais, ...clientesParaAdicionar.map(c => c.id)],
      clientes_detalhes: [...detalhesAtuais, ...novosDetalhes]
    });

    return Response.json({
      sucesso: true,
      vendedor: { id: vendedor.id, nome: vendedor.nome },
      roteiro: { id: roteiro.id, dia_semana: roteiro.dia_semana, criado: roteiroCriado },
      clientes_adicionados: clientesParaAdicionar.map(c => ({
        id: c.id,
        codigo_interno: c.codigo_interno,
        nome: c.razao_social
      }))
    });
  } catch (error) {
    console.error('[execOnceVincularTiago]', error.message);
    return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
  }
});
