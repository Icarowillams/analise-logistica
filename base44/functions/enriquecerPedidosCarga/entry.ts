import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) — canal único ao Omie (portão global) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';
let _credsCache = null;

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) { _credsCache = { appKey: envKey, appSecret: envSecret, at: Date.now() }; return _credsCache; }
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = envKey || String(cfg?.app_key || '').trim();
  const appSecret = envSecret || String(cfg?.app_secret || '').trim();
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

async function omieCall(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [55000, 55000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 500 && /redundante/i.test(corpo)) {
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
          throw new Error(lastErr);
        }
        if (res.status === 425) {
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error') || msg.includes('chave de acesso') || msg.includes('chave inválid') || msg.includes('chave invalid')) {
          lastErr = data.faultstring;
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const normalizar = (valor) => String(valor || '').trim().toLowerCase();
const somenteDigitos = (valor) => String(valor || '').replace(/\D/g, '');
const valorValido = (valor) => valor !== undefined && valor !== null && String(valor).trim() !== '';

async function consultarClienteOmie(base44, codigoClienteOmie) {
  if (!codigoClienteOmie) return null;
  try {
    const data = await omieCall(base44, 'geral/clientes/', { codigo_cliente_omie: Number(codigoClienteOmie) }, { call: 'ConsultarCliente', skipLog: true });
    return data;
  } catch {
    // Mantém o contrato original: qualquer erro/bloqueio → null (enriquecimento é best-effort).
    return null;
  }
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
      const clienteOmie = await consultarClienteOmie(base44, codigo);
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