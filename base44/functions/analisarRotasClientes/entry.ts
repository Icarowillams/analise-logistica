import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function getCodigo(cliente) {
  return cliente.codigo_interno || cliente.codigo_integracao || cliente.codigo || '';
}

function getNome(cliente) {
  return cliente.nome_fantasia || cliente.razao_social || '';
}

function getRotaTag(cliente) {
  const tags = Array.isArray(cliente.tags) ? cliente.tags : [];
  const tag = tags.find(t => String(t).toUpperCase().startsWith('ROTA:'));
  return tag ? String(tag).slice(5).trim() : '';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const textoBusca = String(body.texto || '').trim().toLowerCase();

    const [clientes, rotas, roteiros] = await Promise.all([
      base44.asServiceRole.entities.Cliente.list('-created_date', 10000),
      base44.asServiceRole.entities.Rota.list('-created_date', 1000),
      base44.asServiceRole.entities.Roteiro.list('-created_date', 1000).catch(() => [])
    ]);

    const rotaPorId = new Map(rotas.map(r => [r.id, r]));
    const clientesAtivos = clientes.filter(c => (c.status || 'ativo') === 'ativo');
    const comRotaId = clientes.filter(c => !!c.rota_id);
    const comRotaValida = comRotaId.filter(c => rotaPorId.has(c.rota_id));
    const comRotaInvalida = comRotaId.filter(c => !rotaPorId.has(c.rota_id));
    const semRotaId = clientes.filter(c => !c.rota_id);
    const comTagRota = clientes.filter(c => !!getRotaTag(c));
    const semRotaMasComTag = semRotaId.filter(c => !!getRotaTag(c));

    const clientesEncontrados = textoBusca ? clientes.filter(c => {
      const alvo = [getCodigo(c), getNome(c), c.razao_social || '', c.cnpj_cpf || '', c.cidade || ''].join(' ').toLowerCase();
      return alvo.includes(textoBusca);
    }).map(c => {
      const rota = c.rota_id ? rotaPorId.get(c.rota_id) : null;
      return {
        id: c.id,
        codigo: getCodigo(c),
        nome: getNome(c),
        razao_social: c.razao_social || '',
        cnpj_cpf: c.cnpj_cpf || '',
        cidade: c.cidade || '',
        status: c.status || '',
        rota_id: c.rota_id || null,
        rota_nome: rota?.nome || null,
        rota_valida: !!rota,
        rota_tag: getRotaTag(c) || null
      };
    }) : [];

    const clientesPorRota = rotas.map(r => {
      const porCampo = clientes.filter(c => c.rota_id === r.id);
      const porLista = Array.isArray(r.clientes_ids) ? r.clientes_ids.length : 0;
      return {
        rota_id: r.id,
        rota_nome: r.nome,
        status: r.status,
        clientes_por_campo_cliente: porCampo.length,
        clientes_na_lista_da_rota: porLista,
        exemplos: porCampo.slice(0, 5).map(c => ({ codigo: getCodigo(c), nome: getNome(c), cidade: c.cidade || '' }))
      };
    }).sort((a, b) => b.clientes_por_campo_cliente - a.clientes_por_campo_cliente);

    const tagsRotas = {};
    comTagRota.forEach(c => {
      const rota = getRotaTag(c) || 'Sem tag';
      tagsRotas[rota] = (tagsRotas[rota] || 0) + 1;
    });

    if (textoBusca) {
      return Response.json({
        busca: body.texto,
        encontrados: clientesEncontrados,
        total_encontrados: clientesEncontrados.length
      });
    }

    return Response.json({
      totais: {
        clientes_total: clientes.length,
        clientes_ativos: clientesAtivos.length,
        rotas_total: rotas.length,
        roteiros_total: roteiros.length,
        clientes_com_rota_id: comRotaId.length,
        clientes_com_rota_id_valida: comRotaValida.length,
        clientes_com_rota_id_invalida: comRotaInvalida.length,
        clientes_sem_rota_id: semRotaId.length,
        clientes_com_tag_rota: comTagRota.length,
        clientes_sem_rota_id_mas_com_tag_rota: semRotaMasComTag.length,
        rotas_com_clientes_no_campo_cliente: clientesPorRota.filter(r => r.clientes_por_campo_cliente > 0).length,
        rotas_com_clientes_na_lista_da_rota: clientesPorRota.filter(r => r.clientes_na_lista_da_rota > 0).length
      },
      clientes_por_rota: clientesPorRota,
      top_tags_rota: Object.entries(tagsRotas).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([rota, total]) => ({ rota, total })),
      amostras: {
        sem_rota_id: semRotaId.slice(0, 30).map(c => ({ codigo: getCodigo(c), nome: getNome(c), cidade: c.cidade || '', tags: c.tags || [] })),
        rota_id_invalida: comRotaInvalida.slice(0, 30).map(c => ({ codigo: getCodigo(c), nome: getNome(c), rota_id: c.rota_id, tags: c.tags || [] })),
        sem_rota_id_mas_com_tag_rota: semRotaMasComTag.slice(0, 30).map(c => ({ codigo: getCodigo(c), nome: getNome(c), cidade: c.cidade || '', rota_tag: getRotaTag(c) }))
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});