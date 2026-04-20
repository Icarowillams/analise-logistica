import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Recebe lista de pedidos do Omie (saída do buscarPedidosOmie)
// e enriquece cada pedido com dados do cliente Base44 (nome, cidade, rota, tags)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { pedidos = [] } = body;
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      return Response.json({ sucesso: true, pedidos: [] });
    }

    const codigosOmie = [...new Set(pedidos.map(p => String(p.codigo_cliente)).filter(Boolean))];

    // Busca clientes em blocos para não estourar filtro
    const clientes = [];
    const bloco = 200;
    for (let i = 0; i < codigosOmie.length; i += bloco) {
      const slice = codigosOmie.slice(i, i + bloco);
      const res = await base44.asServiceRole.entities.Cliente.filter({ codigo_omie: { $in: slice } }, '-created_date', 1000);
      clientes.push(...res);
    }

    const mapaCliente = new Map();
    clientes.forEach(c => mapaCliente.set(String(c.codigo_omie), c));

    // Busca rotas para resolver nome
    const rotas = await base44.asServiceRole.entities.Rota.list('-created_date', 500);
    const mapaRota = new Map(rotas.map(r => [r.id, r.nome]));

    // Extrai código COD das tags do cliente (regex ^COD[:\-\s]?(\d+)$)
    const extrairCodigoCod = (tags) => {
      if (!Array.isArray(tags)) return '';
      for (const t of tags) {
        const m = String(t).match(/^COD[:\-\s]?(\d+)$/i);
        if (m) return m[1];
      }
      return '';
    };

    // Resolve rota em cascata: característica Omie "ROTA" > caracteristicas_cliente > cliente.rota_id > "Sem Rota"
    const resolverRota = (pedidoOmie, cliente) => {
      if (pedidoOmie.rota_caracteristica) return pedidoOmie.rota_caracteristica;
      const caracs = pedidoOmie.caracteristicas_cliente || [];
      const rotaCarac = caracs.find(c => /rota/i.test(c?.caracteristica || c?.campo || ''));
      if (rotaCarac) return rotaCarac.conteudo || rotaCarac.valor || '';
      if (cliente?.rota_id && mapaRota.get(cliente.rota_id)) return mapaRota.get(cliente.rota_id);
      return 'Sem Rota';
    };

    const enriquecidos = pedidos.map(p => {
      const c = mapaCliente.get(String(p.codigo_cliente));
      const rotaNome = resolverRota(p, c);
      return {
        ...p,
        cliente_id: c?.id || null,
        nome_cliente: c?.razao_social || `Cliente ${p.codigo_cliente}`,
        nome_fantasia: c?.nome_fantasia || c?.razao_social || `Cliente ${p.codigo_cliente}`,
        cnpj_cpf_cliente: c?.cnpj_cpf || '',
        codigo_cliente_cod: extrairCodigoCod(c?.tags),
        codigo_cliente_integracao: c?.codigo || p.codigo_cliente_integracao || '',
        cidade: c?.cidade || '',
        rota_id: c?.rota_id || null,
        rota_nome: rotaNome || 'Sem Rota',
        rota_cliente: rotaNome || 'Sem Rota',
        tags_cliente: c?.tags || [],
        motorista_padrao_id: c?.motorista_id || null,
        tipo_nota: c?.tipo_nota || '55',
        tipo: 'venda'
      };
    });

    return Response.json({ sucesso: true, pedidos: enriquecidos });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});