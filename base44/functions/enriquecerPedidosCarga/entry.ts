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

    const normalizar = (valor) => String(valor || '').trim().toLowerCase();
    const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '');
    const valorValido = (valor) => valor !== undefined && valor !== null && String(valor).trim() !== '';

    const chavesPedido = (p) => [
      p.codigo_cliente,
      p.codigo_cliente_integracao,
      p.codigo_cliente_cod,
      p.cliente_codigo,
      p.cnpj_cpf_cliente,
      p.cnpj_cpf,
      p.documento_cliente
    ].filter(valorValido);

    const codigosBusca = [...new Set(pedidos.flatMap(chavesPedido).map(String))];
    const pedidoCodigosOmie = [...new Set(pedidos.map(p => String(p.codigo_pedido || '')).filter(Boolean))];
    const pedidoCodigosIntegracao = [...new Set(pedidos.map(p => String(p.codigo_pedido_integracao || '')).filter(Boolean))];

    const [clientesBase, rotas, vendedores, pedidosLocaisBase] = await Promise.all([
      base44.asServiceRole.entities.Cliente.list('-created_date', 10000),
      base44.asServiceRole.entities.Rota.list('-created_date', 1000),
      base44.asServiceRole.entities.Vendedor.list('-created_date', 1000),
      base44.asServiceRole.entities.Pedido.list('-created_date', 5000)
    ]);

    const pedidosLocais = pedidosLocaisBase.filter(p =>
      pedidoCodigosOmie.includes(String(p.omie_codigo_pedido || '')) ||
      pedidoCodigosIntegracao.includes(String(p.id || '')) ||
      pedidoCodigosIntegracao.includes(String(p.codigo_pedido_integracao || ''))
    );

    const clienteIdsLocais = [...new Set(pedidosLocais.map(p => p.cliente_id).filter(Boolean))];
    const codigosBuscaComPedidoLocal = [...new Set([
      ...codigosBusca,
      ...pedidosLocais.flatMap(p => [p.cliente_id, p.cliente_codigo, p.cliente_cpf_cnpj, p.cliente_nome, p.cliente_nome_fantasia].filter(valorValido))
    ].map(String))];

    const clientesExatos = codigosBuscaComPedidoLocal.length
      ? (await Promise.all(codigosBuscaComPedidoLocal.map(async (codigo) => {
          const digitos = somenteDigitos(codigo);
          const buscas = await Promise.all([
            clienteIdsLocais.includes(codigo) ? base44.asServiceRole.entities.Cliente.filter({ id: codigo }, '-created_date', 1).catch(() => []) : [],
            base44.asServiceRole.entities.Cliente.filter({ codigo_omie: codigo }, '-created_date', 5).catch(() => []),
            base44.asServiceRole.entities.Cliente.filter({ codigo: codigo }, '-created_date', 5).catch(() => []),
            base44.asServiceRole.entities.Cliente.filter({ codigo_interno: codigo }, '-created_date', 5).catch(() => []),
            base44.asServiceRole.entities.Cliente.filter({ codigo_integracao: codigo }, '-created_date', 5).catch(() => []),
            digitos && digitos.length >= 11 ? base44.asServiceRole.entities.Cliente.filter({ cnpj_cpf: digitos }, '-created_date', 5).catch(() => []) : []
          ]);
          return buscas.flat();
        }))).flat()
      : [];

    const clientes = Array.from(new Map([...(clientesBase || []), ...(clientesExatos || [])].map(c => [c.id, c])).values());
    const mapaRota = new Map((rotas || []).map(r => [r.id, r.nome]));
    const mapaVendedor = new Map((vendedores || []).map(v => [v.id, v.nome]));

    const clienteIndexes = {
      id: new Map(),
      codigo: new Map(),
      documento: new Map(),
      nome: new Map()
    };

    const indexarCliente = (cliente, chave) => {
      if (valorValido(chave)) clienteIndexes.codigo.set(normalizar(chave), cliente);
    };

    clientes.forEach(c => {
      clienteIndexes.id.set(c.id, c);
      [c.codigo_omie, c.codigo, c.codigo_interno, c.codigo_integracao].forEach(chave => indexarCliente(c, chave));
      const doc = somenteDigitos(c.cnpj_cpf || c.cpf_cnpj);
      if (doc) clienteIndexes.documento.set(doc, c);
      [c.razao_social, c.nome_fantasia].filter(valorValido).forEach(nome => clienteIndexes.nome.set(normalizar(nome), c));
    });

    const mapaPedidoLocalPorOmie = new Map();
    const mapaPedidoLocalPorIntegracao = new Map();
    pedidosLocais.forEach(p => {
      if (p.omie_codigo_pedido) mapaPedidoLocalPorOmie.set(String(p.omie_codigo_pedido), p);
      if (p.id) mapaPedidoLocalPorIntegracao.set(String(p.id), p);
      if (p.codigo_pedido_integracao) mapaPedidoLocalPorIntegracao.set(String(p.codigo_pedido_integracao), p);
    });

    const resolverPedidoLocal = (p) =>
      mapaPedidoLocalPorOmie.get(String(p.codigo_pedido || '')) ||
      mapaPedidoLocalPorIntegracao.get(String(p.codigo_pedido_integracao || '')) ||
      null;

    const resolverCliente = (p, pedidoLocal) => {
      if (pedidoLocal?.cliente_id && clienteIndexes.id.get(pedidoLocal.cliente_id)) return clienteIndexes.id.get(pedidoLocal.cliente_id);
      const chaves = [...chavesPedido(p), pedidoLocal?.cliente_codigo, pedidoLocal?.cliente_cpf_cnpj, pedidoLocal?.cliente_nome, pedidoLocal?.cliente_nome_fantasia].filter(valorValido);
      for (const chave of chaves) {
        const texto = normalizar(chave);
        const digitos = somenteDigitos(chave);
        const encontrado = clienteIndexes.codigo.get(texto) || (digitos.length >= 11 ? clienteIndexes.documento.get(digitos) : null);
        if (encontrado) return encontrado;
      }
      return clienteIndexes.nome.get(normalizar(pedidoLocal?.cliente_nome)) || clienteIndexes.nome.get(normalizar(pedidoLocal?.cliente_nome_fantasia)) || clienteIndexes.nome.get(normalizar(p.nome_cliente)) || clienteIndexes.nome.get(normalizar(p.nome_fantasia)) || null;
    };

    const extrairCodigoCod = (cliente) => {
      if (!cliente) return '';
      const direto = cliente.codigo_interno || cliente.codigo_integracao || cliente.codigo || cliente.codigo_omie;
      if (direto) return String(direto);
      if (!Array.isArray(cliente.tags)) return '';
      for (const t of cliente.tags) {
        const m = String(t).match(/^(COD|CODIGO|CÓDIGO|CODIGO_CLIENTE)[:\-\s]?(\d+)$/i);
        if (m) return m[2];
      }
      return '';
    };

    const resolverRota = (pedidoOmie, cliente) => {
      if (pedidoOmie.rota_caracteristica) return pedidoOmie.rota_caracteristica;
      if (pedidoOmie.rota_cliente && pedidoOmie.rota_cliente !== 'Sem Rota') return pedidoOmie.rota_cliente;
      const caracs = pedidoOmie.caracteristicas_cliente || [];
      const rotaCarac = caracs.find(c => /rota/i.test(c?.caracteristica || c?.campo || ''));
      if (rotaCarac) return rotaCarac.conteudo || rotaCarac.valor || '';
      if (cliente?.rota_nome) return cliente.rota_nome;
      if (cliente?.rota_id && mapaRota.get(cliente.rota_id)) return mapaRota.get(cliente.rota_id);
      return 'Sem Rota';
    };

    const enriquecidos = pedidos.map(p => {
      const pedidoLocal = resolverPedidoLocal(p);
      const c = resolverCliente(p, pedidoLocal);
      const rotaNome = resolverRota(p, c) || pedidoLocal?.rota_nome;
      const vendedorNome = c?.vendedor_id ? mapaVendedor.get(c.vendedor_id) : '';
      const nomeCliente = c?.razao_social || pedidoLocal?.cliente_nome || p.nome_cliente || `Cliente ${p.codigo_cliente || p.codigo_cliente_integracao || ''}`;
      return {
        ...p,
        cliente_id: c?.id || pedidoLocal?.cliente_id || p.cliente_id || null,
        nome_cliente: nomeCliente,
        nome_fantasia: c?.nome_fantasia || pedidoLocal?.cliente_nome_fantasia || p.nome_fantasia || nomeCliente,
        cnpj_cpf_cliente: c?.cnpj_cpf || pedidoLocal?.cliente_cpf_cnpj || p.cnpj_cpf_cliente || '',
        codigo_cliente_cod: extrairCodigoCod(c) || pedidoLocal?.cliente_codigo || p.codigo_cliente_cod || p.codigo_cliente_integracao || p.codigo_cliente || '',
        codigo_cliente_integracao: c?.codigo_integracao || c?.codigo || pedidoLocal?.cliente_codigo || p.codigo_cliente_integracao || '',
        cidade: c?.cidade || pedidoLocal?.cliente_cidade || p.cidade || '',
        vendedor_id: c?.vendedor_id || pedidoLocal?.vendedor_id || p.vendedor_id || null,
        vendedor_nome: vendedorNome || pedidoLocal?.vendedor_nome || p.vendedor_nome || '',
        rota_id: c?.rota_id || pedidoLocal?.rota_id || p.rota_id || null,
        rota_nome: rotaNome || 'Sem Rota',
        rota_cliente: rotaNome || 'Sem Rota',
        tags_cliente: c?.tags || p.tags_cliente || [],
        motorista_padrao_id: c?.motorista_id || null,
        tipo_nota: c?.tipo_nota || pedidoLocal?.modelo_nota || p.tipo_nota || '55',
        tipo: 'venda'
      };
    });

    return Response.json({ sucesso: true, pedidos: enriquecidos });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});