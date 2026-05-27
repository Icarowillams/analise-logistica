import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_CLIENTES_URL = 'https://app.omie.com.br/api/v1/geral/clientes/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

let base44Global = null;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizar = (v) => String(v || '').trim().toLowerCase();
const somenteDigitos = (v) => String(v || '').replace(/\D/g, '');
const valorValido = (v) => v !== undefined && v !== null && String(v).trim() !== '';

async function omieCall(call, param, opts = {}, url = OMIE_URL) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
  const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
  const cb = await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
  if (cacheMinutes > 0) {
    const caches = await base44Global.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
    if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
  }
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }) });
    const data = await res.json();
    if (data.faultstring || data.faultcode) {
      const msg = String(data.faultstring || '').toLowerCase();
      if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon')) { lastError = data.faultstring; await delay(2500 * tentativa); continue; }
      throw new Error(data.faultstring || 'Erro Omie');
    }
    if (cacheMinutes > 0) {
      const payloadCache = { chave, valor: data, tipo: call, expira_em: new Date(Date.now() + cacheMinutes * 60000).toISOString(), criado_em: new Date().toISOString() };
      const existente = await base44Global.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
      if (existente?.[0]?.id) await base44Global.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payloadCache).catch(() => {}); else await base44Global.asServiceRole.entities.CacheOmieConsulta.create(payloadCache).catch(() => {});
    }
    if (logIntegration) await base44Global.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'sucesso', payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

async function consultarClienteOmie(codigoCliente) {
  try {
    const data = await omieCall('ConsultarCliente', { codigo_cliente_omie: Number(codigoCliente) }, 1, OMIE_CLIENTES_URL);
    return {
      codigo_omie: String(data.codigo_cliente_omie || codigoCliente),
      codigo_integracao: data.codigo_cliente_integracao || '',
      razao_social: data.razao_social || '',
      nome_fantasia: data.nome_fantasia || data.razao_social || '',
      cnpj_cpf: data.cnpj_cpf || '',
      cidade: data.cidade || '',
      estado: data.estado || ''
    };
  } catch {
    return null;
  }
}

function pedidoCancelado(pedido) {
  const cab = pedido?.cabecalho || {};
  const info = [cab.cancelado, cab.status_pedido, cab.status, cab.etapa, cab.descricao_status].filter(Boolean).join(' ').toLowerCase();
  return cab.cancelado === 'S' || info.includes('cancelado') || info.includes('cancelada');
}

function criarIndicesClientes(clientes) {
  const indices = { porId: new Map(), porCodigo: new Map(), porDocumento: new Map(), porNome: new Map() };
  const indexarCodigo = (cli, cod) => { if (valorValido(cod)) indices.porCodigo.set(normalizar(cod), cli); };
  clientes.forEach((c) => {
    indices.porId.set(c.id, c);
    [c.codigo_omie, c.codigo_cliente_omie, c.codigo, c.codigo_interno, c.codigo_integracao].forEach((cod) => indexarCodigo(c, cod));
    const doc = somenteDigitos(c.cnpj_cpf || c.cpf_cnpj);
    if (doc) indices.porDocumento.set(doc, c);
    [c.razao_social, c.nome_fantasia].filter(valorValido).forEach((n) => indices.porNome.set(normalizar(n), c));
  });
  return indices;
}

function buscarClienteLocal(pedidoOmie, pedidoLocal, indices) {
  if (pedidoLocal?.cliente_id && indices.porId.has(pedidoLocal.cliente_id)) return indices.porId.get(pedidoLocal.cliente_id);
  const codigos = [pedidoLocal?.cliente_codigo, pedidoOmie.codigo_cliente_integracao, pedidoOmie.codigo_cliente_cod, pedidoOmie.codigo_cliente].filter(valorValido);
  for (const cod of codigos) {
    const c = indices.porCodigo.get(normalizar(cod));
    if (c) return c;
  }
  const docs = [pedidoLocal?.cliente_cpf_cnpj, pedidoOmie.cnpj_cpf_cliente].map(somenteDigitos).filter((d) => d.length >= 11);
  for (const d of docs) {
    const c = indices.porDocumento.get(d);
    if (c) return c;
  }
  const nomes = [pedidoLocal?.cliente_nome_fantasia, pedidoLocal?.cliente_nome, pedidoOmie.nome_fantasia, pedidoOmie.nome_cliente].filter(valorValido);
  for (const n of nomes) {
    const c = indices.porNome.get(normalizar(n));
    if (c) return c;
  }
  return null;
}

function montarRegistroEspelho(pedidoOmie, indices, mapaRota, mapaVendedor, pedidoLocalPorOmie, origem, clienteOmieFallback = null) {
  const pedidoLocal = pedidoLocalPorOmie.get(String(pedidoOmie.codigo_pedido)) || null;
  const cliente = buscarClienteLocal(pedidoOmie, pedidoLocal, indices);
  const rotaNome = cliente?.rota_id ? (mapaRota.get(cliente.rota_id) || '') : (pedidoLocal?.rota_nome || '');
  const vendedorNome = cliente?.vendedor_id ? (mapaVendedor.get(cliente.vendedor_id) || '') : (pedidoLocal?.vendedor_nome || '');
  const nomeCliente = cliente?.razao_social || pedidoLocal?.cliente_nome || clienteOmieFallback?.razao_social || pedidoOmie.nome_cliente || `Cliente ${pedidoOmie.codigo_cliente || ''}`;
  const fantasia = cliente?.nome_fantasia || pedidoLocal?.cliente_nome_fantasia || clienteOmieFallback?.nome_fantasia || pedidoOmie.nome_fantasia || nomeCliente;
  const codigoCliente = String(cliente?.codigo_interno || cliente?.codigo || cliente?.codigo_integracao || pedidoLocal?.cliente_codigo || clienteOmieFallback?.codigo_integracao || pedidoOmie.codigo_cliente_cod || pedidoOmie.codigo_cliente_integracao || pedidoOmie.codigo_cliente || '');

  return {
    codigo_pedido: String(pedidoOmie.codigo_pedido),
    codigo_pedido_integracao: pedidoOmie.codigo_pedido_integracao || '',
    numero_pedido: String(pedidoOmie.numero_pedido || ''),
    etapa: String(pedidoOmie.etapa || '20'),
    status_real: pedidoOmie.status_real || null,
    status_label: pedidoOmie.status_label || null,
    numero_nf: pedidoOmie.numero_nf || '',
    data_faturamento: pedidoOmie.data_faturamento || null,
    codigo_cliente: String(pedidoOmie.codigo_cliente || ''),
    codigo_cliente_integracao: cliente?.codigo_integracao || cliente?.codigo || pedidoLocal?.cliente_codigo || clienteOmieFallback?.codigo_integracao || pedidoOmie.codigo_cliente_integracao || '',
    codigo_cliente_cod: codigoCliente,
    cnpj_cpf_cliente: cliente?.cnpj_cpf || pedidoLocal?.cliente_cpf_cnpj || clienteOmieFallback?.cnpj_cpf || pedidoOmie.cnpj_cpf_cliente || '',
    cliente_id: cliente?.id || pedidoLocal?.cliente_id || null,
    nome_cliente: nomeCliente,
    nome_fantasia: fantasia,
    cidade: cliente?.cidade || pedidoLocal?.cliente_cidade || clienteOmieFallback?.cidade || pedidoOmie.cidade || '',
    tipo_nota: cliente?.tipo_nota || pedidoLocal?.modelo_nota || '55',
    tags_cliente: cliente?.tags || [],
    motorista_padrao_id: cliente?.motorista_id || null,
    rota_id: cliente?.rota_id || pedidoLocal?.rota_id || null,
    rota_nome: rotaNome || 'Sem Rota',
    rota_cliente: rotaNome || 'Sem Rota',
    vendedor_id: cliente?.vendedor_id || pedidoLocal?.vendedor_id || null,
    vendedor_nome: vendedorNome,
    data_previsao: pedidoOmie.data_previsao || '',
    quantidade_itens: pedidoOmie.quantidade_itens || (pedidoOmie.produtos || []).length,
    valor_total_pedido: pedidoOmie.valor_total_pedido || 0,
    pedido_id: pedidoLocal?.id || null,
    produtos: pedidoOmie.produtos || [],
    sincronizado_em: new Date().toISOString(),
    origem_sync: origem
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    base44Global = base44;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { max_paginas = 10, origem = 'reconciliacao', etapas = ['10', '20', '50', '60'] } = body;
    const t0 = Date.now();

    const calcularStatusNF = (cab, infoNfe) => {
      if (infoNfe?.cStatus === 'CANCELADA' || cab?.cancelado === 'S') return { status_real: 'cancelada', status_label: 'NF Cancelada' };
      if (infoNfe?.cStatus === 'DENEGADA') return { status_real: 'denegada', status_label: 'NF Denegada' };
      if (infoNfe?.cStatus === 'REJEITADA') return { status_real: 'rejeitada', status_label: 'NF Rejeitada' };
      if (infoNfe?.cStatus === 'AUTORIZADA' || infoNfe?.nNF) return { status_real: 'emitida', status_label: 'Faturado' };
      return { status_real: 'aguardando_nf', status_label: 'Aguardando NF' };
    };

    const todosOmie = [];
    for (const etapaAtual of etapas) {
      let pagina = 1;
      let totalPaginas = 1;
      do {
        const data = await omieCall('ListarPedidos', {
          pagina,
          registros_por_pagina: 100,
          apenas_importado_api: 'N',
          etapa: etapaAtual
        }, { cacheMinutes: 10 }).catch((e) => {
          if (/n[ãa]o existem registros/i.test(e.message)) return null;
          throw e;
        });
        if (!data) break;
        totalPaginas = Math.min(Number(data.total_de_paginas || 1), Number(max_paginas));
        const lote = (data.pedido_venda_produto || [])
          .filter((p) => !pedidoCancelado(p))
          .map((p) => {
            const cab = p.cabecalho || {};
            const infoNfe = p.infoNfe || p.info_nf || null;
            const etapa = String(cab.etapa || etapaAtual);
            const statusNf = etapa === '60' ? calcularStatusNF(cab, infoNfe) : { status_real: null, status_label: null };
            return {
              codigo_pedido: String(cab.codigo_pedido || ''),
              codigo_pedido_integracao: cab.codigo_pedido_integracao || '',
              numero_pedido: cab.numero_pedido || '',
              codigo_cliente: String(cab.codigo_cliente || ''),
              data_previsao: cab.data_previsao || '',
              etapa,
              status_real: statusNf.status_real,
              status_label: statusNf.status_label,
              numero_nf: String(infoNfe?.nNF || infoNfe?.numero_nf || cab.numero_nfe || ''),
              data_faturamento: etapa === '60' ? (infoNfe?.dEmiNFe || null) : null,
              valor_total_pedido: p.total_pedido?.valor_total_pedido || 0,
              quantidade_itens: (p.det || []).length,
              produtos: (p.det || []).map((d) => ({
                codigo_produto: String(d.produto?.codigo_produto || ''),
                codigo_produto_integracao: d.produto?.codigo_produto_integracao || '',
                descricao: d.produto?.descricao || '',
                quantidade: d.produto?.quantidade || 0,
                valor_unitario: d.produto?.valor_unitario || 0,
                valor_total: d.produto?.valor_total || 0,
                unidade: d.produto?.unidade || ''
              }))
            };
          });
        todosOmie.push(...lote);
        pagina += 1;
        if (pagina <= totalPaginas) await delay(900);
      } while (pagina <= totalPaginas);
    }

    const [clientes, rotas, vendedores, pedidosLocais, espelhoAtual] = await Promise.all([
      base44.asServiceRole.entities.Cliente.list('-created_date', 10000),
      base44.asServiceRole.entities.Rota.list('-created_date', 1000),
      base44.asServiceRole.entities.Vendedor.list('-created_date', 1000),
      base44.asServiceRole.entities.Pedido.list('-created_date', 5000),
      base44.asServiceRole.entities.PedidoLiberadoOmie.list('-created_date', 5000)
    ]);

    const indices = criarIndicesClientes(clientes || []);
    const mapaRota = new Map((rotas || []).map((r) => [r.id, r.nome]));
    const mapaVendedor = new Map((vendedores || []).map((v) => [v.id, v.nome]));
    const pedidoLocalPorOmie = new Map();
    (pedidosLocais || []).forEach((p) => { if (p.omie_codigo_pedido) pedidoLocalPorOmie.set(String(p.omie_codigo_pedido), p); });

    const espelhoPorCodigo = new Map((espelhoAtual || []).map((e) => [String(e.codigo_pedido), e]));
    const codigosOmieAtuais = new Set(todosOmie.map((p) => String(p.codigo_pedido)));

    const codigosClienteFaltantes = new Set();
    for (const p of todosOmie) {
      const pedidoLocal = pedidoLocalPorOmie.get(String(p.codigo_pedido)) || null;
      const cli = buscarClienteLocal(p, pedidoLocal, indices);
      if (!cli && p.codigo_cliente) codigosClienteFaltantes.add(String(p.codigo_cliente));
    }

    const mapaClienteOmieFallback = new Map();
    let consultasFallback = 0;
    for (const codigo of codigosClienteFaltantes) {
      const dados = await consultarClienteOmie(codigo);
      if (dados) mapaClienteOmieFallback.set(codigo, dados);
      consultasFallback += 1;
      await delay(350);
    }

    let criados = 0;
    let atualizados = 0;
    for (const pedidoOmie of todosOmie) {
      const fallback = mapaClienteOmieFallback.get(String(pedidoOmie.codigo_cliente)) || null;
      const registro = montarRegistroEspelho(pedidoOmie, indices, mapaRota, mapaVendedor, pedidoLocalPorOmie, origem, fallback);
      const existente = espelhoPorCodigo.get(registro.codigo_pedido);
      if (existente) {
        const statusProtegido = ['rejeitada', 'denegada', 'cancelada'].includes(String(existente.status_real || ''));
        const registroFinal = statusProtegido && registro.status_real === 'aguardando_nf'
          ? { ...registro, status_real: existente.status_real, status_label: existente.status_label, numero_nf: existente.numero_nf || registro.numero_nf, data_faturamento: existente.data_faturamento || registro.data_faturamento }
          : registro;
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(existente.id, registroFinal);
        atualizados += 1;
      } else {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.create(registro);
        criados += 1;
      }
    }

    let removidos = 0;
    for (const espelho of (espelhoAtual || [])) {
      if (!codigosOmieAtuais.has(String(espelho.codigo_pedido))) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.delete(espelho.id);
        removidos += 1;
      }
    }

    const duracao = Date.now() - t0;
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'ListarPedidos',
      operacao: origem === 'reconciliacao' ? 'reconciliar_espelho_pedidos' : 'bootstrap_espelho_pedidos',
      status: 'sucesso',
      duracao_ms: duracao,
      payload_resposta: JSON.stringify({ total_omie: todosOmie.length, criados, atualizados, removidos }).slice(0, 2000)
    }).catch(() => {});

    return Response.json({ sucesso: true, total_omie: todosOmie.length, total: todosOmie.length, criados, atualizados, removidos, consultas_fallback_cliente: consultasFallback, duracao_ms: duracao });
  } catch (error) {
    return Response.json({ sucesso: false, error: error.message }, { status: 500 });
  }
});