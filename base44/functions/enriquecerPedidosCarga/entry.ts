import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
const OMIE_CLIENTES_URL = 'https://app.omie.com.br/api/v1/geral/clientes/';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const normalizar = (valor) => String(valor || '').trim().toLowerCase();
const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '');
const valorValido = (valor) => valor !== undefined && valor !== null && String(valor).trim() !== '';

async function consultarClienteOmie(codigoClienteOmie) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET || !codigoClienteOmie) return null;

  const response = await fetch(OMIE_CLIENTES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarCliente',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{ codigo_cliente_omie: Number(codigoClienteOmie) }]
    })
  });

  const data = await response.json();
  if (data.faultstring) return null;
  return data;
}

function criarIndicesClientes(clientes) {
  const indices = {
    porId: new Map(),
    porCodigo: new Map(),
    porDocumento: new Map(),
    porNome: new Map()
  };

  const indexarCodigo = (cliente, codigo) => {
    if (valorValido(codigo)) indices.porCodigo.set(normalizar(codigo), cliente);
  };

  clientes.forEach(cliente => {
    indices.porId.set(cliente.id, cliente);
    [cliente.codigo_omie, cliente.codigo, cliente.codigo_interno, cliente.codigo_integracao].forEach(codigo => indexarCodigo(cliente, codigo));

    const documento = somenteDigitos(cliente.cnpj_cpf || cliente.cpf_cnpj);
    if (documento) indices.porDocumento.set(documento, cliente);

    [cliente.razao_social, cliente.nome_fantasia].filter(valorValido).forEach(nome => {
      indices.porNome.set(normalizar(nome), cliente);
    });
  });

  return indices;
}

function buscarClienteLocal(pedidoOmie, pedidoLocal, clienteOmie, indices) {
  if (pedidoLocal?.cliente_id && indices.porId.has(pedidoLocal.cliente_id)) {
    return indices.porId.get(pedidoLocal.cliente_id);
  }

  const codigos = [
    pedidoLocal?.cliente_codigo,
    pedidoOmie.codigo_cliente_integracao,
    pedidoOmie.codigo_cliente_cod,
    clienteOmie?.codigo_cliente_integracao,
    clienteOmie?.codigo_cliente_omie,
    pedidoOmie.codigo_cliente,
    clienteOmie?.codigo
  ].filter(valorValido);

  for (const codigo of codigos) {
    const cliente = indices.porCodigo.get(normalizar(codigo));
    if (cliente) return cliente;
  }

  const documentos = [
    pedidoLocal?.cliente_cpf_cnpj,
    pedidoOmie.cnpj_cpf_cliente,
    clienteOmie?.cnpj_cpf,
    clienteOmie?.cpf_cnpj
  ].map(somenteDigitos).filter(doc => doc.length >= 11);

  for (const documento of documentos) {
    const cliente = indices.porDocumento.get(documento);
    if (cliente) return cliente;
  }

  const nomes = [
    pedidoLocal?.cliente_nome_fantasia,
    pedidoLocal?.cliente_nome,
    pedidoOmie.nome_fantasia,
    pedidoOmie.nome_cliente,
    clienteOmie?.nome_fantasia,
    clienteOmie?.razao_social
  ].filter(valorValido);

  for (const nome of nomes) {
    const cliente = indices.porNome.get(normalizar(nome));
    if (cliente) return cliente;
  }

  return null;
}

function extrairCodigoCliente(cliente, pedidoLocal, pedidoOmie, clienteOmie) {
  return String(
    cliente?.codigo_interno ||
    cliente?.codigo ||
    cliente?.codigo_integracao ||
    pedidoLocal?.cliente_codigo ||
    clienteOmie?.codigo_cliente_integracao ||
    pedidoOmie.codigo_cliente_cod ||
    pedidoOmie.codigo_cliente_integracao ||
    pedidoOmie.codigo_cliente ||
    ''
  );
}

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

    const [clientes, rotas, vendedores, pedidosLocais] = await Promise.all([
      base44.asServiceRole.entities.Cliente.list('-created_date', 10000),
      base44.asServiceRole.entities.Rota.list('-created_date', 1000),
      base44.asServiceRole.entities.Vendedor.list('-created_date', 1000),
      base44.asServiceRole.entities.Pedido.list('-created_date', 5000)
    ]);

    const indices = criarIndicesClientes(clientes || []);
    const mapaRota = new Map((rotas || []).map(rota => [rota.id, rota.nome]));
    const mapaVendedor = new Map((vendedores || []).map(vendedor => [vendedor.id, vendedor.nome]));

    const pedidosLocaisPorOmie = new Map();
    const pedidosLocaisPorIntegracao = new Map();
    (pedidosLocais || []).forEach(pedido => {
      if (pedido.omie_codigo_pedido) pedidosLocaisPorOmie.set(String(pedido.omie_codigo_pedido), pedido);
      if (pedido.id) pedidosLocaisPorIntegracao.set(String(pedido.id), pedido);
      if (pedido.codigo_pedido_integracao) pedidosLocaisPorIntegracao.set(String(pedido.codigo_pedido_integracao), pedido);
    });

    const codigosClientesOmie = [...new Set(pedidos.map(p => String(p.codigo_cliente || '')).filter(Boolean))];
    const clientesOmie = new Map();
    for (const codigo of codigosClientesOmie) {
      const clienteOmie = await consultarClienteOmie(codigo);
      if (clienteOmie) clientesOmie.set(String(codigo), clienteOmie);
      await delay(250);
    }

    const enriquecidos = pedidos.map(pedidoOmie => {
      const pedidoLocal = pedidosLocaisPorOmie.get(String(pedidoOmie.codigo_pedido || '')) ||
        pedidosLocaisPorIntegracao.get(String(pedidoOmie.codigo_pedido_integracao || '')) || null;
      const clienteOmie = clientesOmie.get(String(pedidoOmie.codigo_cliente || '')) || null;
      const cliente = buscarClienteLocal(pedidoOmie, pedidoLocal, clienteOmie, indices);

      const rotaNome = cliente?.rota_id ? (mapaRota.get(cliente.rota_id) || '') : (pedidoLocal?.rota_nome || pedidoOmie.rota_cliente || '');
      const vendedorNome = cliente?.vendedor_id ? (mapaVendedor.get(cliente.vendedor_id) || '') : (pedidoLocal?.vendedor_nome || pedidoOmie.vendedor_nome || '');
      const nomeCliente = cliente?.razao_social || pedidoLocal?.cliente_nome || clienteOmie?.razao_social || pedidoOmie.nome_cliente || `Cliente ${pedidoOmie.codigo_cliente || ''}`;
      const fantasia = cliente?.nome_fantasia || pedidoLocal?.cliente_nome_fantasia || clienteOmie?.nome_fantasia || pedidoOmie.nome_fantasia || nomeCliente;

      return {
        ...pedidoOmie,
        pedido_id: pedidoLocal?.id || null,
        cliente_id: cliente?.id || pedidoLocal?.cliente_id || null,
        nome_cliente: nomeCliente,
        nome_fantasia: fantasia,
        cnpj_cpf_cliente: cliente?.cnpj_cpf || pedidoLocal?.cliente_cpf_cnpj || clienteOmie?.cnpj_cpf || pedidoOmie.cnpj_cpf_cliente || '',
        codigo_cliente_cod: extrairCodigoCliente(cliente, pedidoLocal, pedidoOmie, clienteOmie),
        codigo_cliente_integracao: cliente?.codigo_integracao || cliente?.codigo || pedidoLocal?.cliente_codigo || clienteOmie?.codigo_cliente_integracao || pedidoOmie.codigo_cliente_integracao || '',
        cidade: cliente?.cidade || pedidoLocal?.cliente_cidade || pedidoOmie.cidade || '',
        vendedor_id: cliente?.vendedor_id || pedidoLocal?.vendedor_id || pedidoOmie.vendedor_id || null,
        vendedor_nome: vendedorNome,
        rota_id: cliente?.rota_id || pedidoLocal?.rota_id || pedidoOmie.rota_id || null,
        rota_nome: rotaNome || 'Sem Rota',
        rota_cliente: rotaNome || 'Sem Rota',
        tags_cliente: cliente?.tags || pedidoOmie.tags_cliente || [],
        motorista_padrao_id: cliente?.motorista_id || null,
        tipo_nota: cliente?.tipo_nota || pedidoLocal?.modelo_nota || pedidoOmie.tipo_nota || '55',
        tipo: 'venda'
      };
    });

    return Response.json({ sucesso: true, pedidos: enriquecidos });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});