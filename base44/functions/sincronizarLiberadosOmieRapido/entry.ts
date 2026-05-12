import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ⚡ Sincronização RÁPIDA do espelho PedidoLiberadoOmie — apenas etapa 20 (Liberados),
// usado no botão "Atualizar" de Montagem de Carga.
//
// Diferença do bootstrapPedidosLiberadosOmie:
//   - Apenas etapa 20 (não 10/50/60)
//   - Apenas 1 página (limite 100 pedidos novos por vez)
//   - Não remove do espelho pedidos que sumiram (isso fica para a reconciliação agendada)
//   - Foco em ADICIONAR pedidos recém-liberados que ainda não chegaram via webhook

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

const normalizar = (v) => String(v || '').trim().toLowerCase();
const somenteDigitos = (v) => String(v || '').replace(/\D/g, '');
const valorValido = (v) => v !== undefined && v !== null && String(v).trim() !== '';

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const transient = msg.includes('cota') || msg.includes('aguarde') || msg.includes('timeout') || msg.includes('redundante');
    if (transient && tentativa < 3) {
      await new Promise(r => setTimeout(r, 1500 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

function criarIndicesClientes(clientes) {
  const indices = { porId: new Map(), porCodigo: new Map(), porDocumento: new Map(), porNome: new Map() };
  const idxCod = (cli, cod) => { if (valorValido(cod)) indices.porCodigo.set(normalizar(cod), cli); };
  clientes.forEach((c) => {
    indices.porId.set(c.id, c);
    [c.codigo_omie, c.codigo, c.codigo_interno, c.codigo_integracao].forEach((cod) => idxCod(c, cod));
    const doc = somenteDigitos(c.cnpj_cpf || c.cpf_cnpj);
    if (doc) indices.porDocumento.set(doc, c);
    [c.razao_social, c.nome_fantasia].filter(valorValido).forEach((n) => indices.porNome.set(normalizar(n), c));
  });
  return indices;
}

function buscarClienteLocal(pedidoOmie, pedidoLocal, indices) {
  if (pedidoLocal?.cliente_id && indices.porId.has(pedidoLocal.cliente_id)) return indices.porId.get(pedidoLocal.cliente_id);
  const codigos = [pedidoLocal?.cliente_codigo, pedidoOmie.codigo_cliente_integracao, pedidoOmie.codigo_cliente].filter(valorValido);
  for (const cod of codigos) {
    const c = indices.porCodigo.get(normalizar(cod));
    if (c) return c;
  }
  const docs = [pedidoLocal?.cliente_cpf_cnpj, pedidoOmie.cnpj_cpf_cliente].map(somenteDigitos).filter((d) => d.length >= 11);
  for (const d of docs) {
    const c = indices.porDocumento.get(d);
    if (c) return c;
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const t0 = Date.now();

    // 1. Buscar etapa 20 do Omie (1 página, até 100 pedidos)
    const data = await omieCall('ListarPedidos', {
      pagina: 1,
      registros_por_pagina: 100,
      apenas_importado_api: 'N',
      etapa: '20'
    }).catch((e) => {
      if (/n[ãa]o existem registros/i.test(e.message)) return null;
      throw e;
    });

    const pedidosOmie = (data?.pedido_venda_produto || [])
      .filter((p) => p.cabecalho?.cancelado !== 'S')
      .map((p) => {
        const cab = p.cabecalho || {};
        return {
          codigo_pedido: String(cab.codigo_pedido || ''),
          codigo_pedido_integracao: cab.codigo_pedido_integracao || '',
          numero_pedido: String(cab.numero_pedido || ''),
          codigo_cliente: String(cab.codigo_cliente || ''),
          codigo_cliente_integracao: cab.codigo_cliente_integracao || '',
          cnpj_cpf_cliente: cab.cnpj_cpf_cliente || '',
          nome_cliente: cab.nome_cliente || '',
          nome_fantasia: cab.nome_fantasia || '',
          cidade: cab.cidade || '',
          data_previsao: cab.data_previsao || '',
          etapa: '20',
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

    if (pedidosOmie.length === 0) {
      return Response.json({ sucesso: true, total: 0, criados: 0, atualizados: 0, duracao_ms: Date.now() - t0 });
    }

    // 2. Cadastros locais (leves)
    const [clientes, rotas, vendedores, pedidosLocais, espelhoAtual] = await Promise.all([
      base44.asServiceRole.entities.Cliente.list('-created_date', 10000),
      base44.asServiceRole.entities.Rota.list('-created_date', 1000),
      base44.asServiceRole.entities.Vendedor.list('-created_date', 1000),
      base44.asServiceRole.entities.Pedido.list('-created_date', 5000),
      base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ etapa: '20' }, '-created_date', 5000)
    ]);

    const indices = criarIndicesClientes(clientes || []);
    const mapaRota = new Map((rotas || []).map((r) => [r.id, r.nome]));
    const mapaVendedor = new Map((vendedores || []).map((v) => [v.id, v.nome]));
    const pedidoLocalPorOmie = new Map();
    (pedidosLocais || []).forEach((p) => { if (p.omie_codigo_pedido) pedidoLocalPorOmie.set(String(p.omie_codigo_pedido), p); });
    const espelhoPorCodigo = new Map((espelhoAtual || []).map((e) => [String(e.codigo_pedido), e]));

    // 3. Upsert
    let criados = 0;
    let atualizados = 0;
    for (const p of pedidosOmie) {
      const pedidoLocal = pedidoLocalPorOmie.get(p.codigo_pedido) || null;
      const cliente = buscarClienteLocal(p, pedidoLocal, indices);
      const rotaNome = cliente?.rota_id ? (mapaRota.get(cliente.rota_id) || '') : (pedidoLocal?.rota_nome || '');
      const vendedorNome = cliente?.vendedor_id ? (mapaVendedor.get(cliente.vendedor_id) || '') : (pedidoLocal?.vendedor_nome || '');
      const nome = cliente?.razao_social || pedidoLocal?.cliente_nome || p.nome_cliente || `Cliente ${p.codigo_cliente}`;
      const fantasia = cliente?.nome_fantasia || pedidoLocal?.cliente_nome_fantasia || p.nome_fantasia || nome;

      const registro = {
        codigo_pedido: p.codigo_pedido,
        codigo_pedido_integracao: p.codigo_pedido_integracao,
        numero_pedido: p.numero_pedido,
        etapa: '20',
        status_real: null,
        status_label: null,
        numero_nf: '',
        codigo_cliente: p.codigo_cliente,
        codigo_cliente_integracao: cliente?.codigo_integracao || cliente?.codigo || pedidoLocal?.cliente_codigo || p.codigo_cliente_integracao || '',
        codigo_cliente_cod: String(cliente?.codigo_interno || cliente?.codigo || cliente?.codigo_integracao || pedidoLocal?.cliente_codigo || p.codigo_cliente_integracao || p.codigo_cliente || ''),
        cnpj_cpf_cliente: cliente?.cnpj_cpf || pedidoLocal?.cliente_cpf_cnpj || p.cnpj_cpf_cliente || '',
        cliente_id: cliente?.id || pedidoLocal?.cliente_id || null,
        nome_cliente: nome,
        nome_fantasia: fantasia,
        cidade: cliente?.cidade || pedidoLocal?.cliente_cidade || p.cidade || '',
        tipo_nota: cliente?.tipo_nota || pedidoLocal?.modelo_nota || '55',
        tags_cliente: cliente?.tags || [],
        motorista_padrao_id: cliente?.motorista_id || null,
        rota_id: cliente?.rota_id || pedidoLocal?.rota_id || null,
        rota_nome: rotaNome || 'Sem Rota',
        rota_cliente: rotaNome || 'Sem Rota',
        vendedor_id: cliente?.vendedor_id || pedidoLocal?.vendedor_id || null,
        vendedor_nome: vendedorNome,
        data_previsao: p.data_previsao,
        quantidade_itens: p.quantidade_itens,
        valor_total_pedido: p.valor_total_pedido,
        pedido_id: pedidoLocal?.id || null,
        produtos: p.produtos,
        sincronizado_em: new Date().toISOString(),
        origem_sync: 'reconciliacao'
      };

      const existente = espelhoPorCodigo.get(p.codigo_pedido);
      if (existente) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(existente.id, registro);
        atualizados += 1;
      } else {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.create(registro);
        criados += 1;
      }
    }

    return Response.json({
      sucesso: true,
      total: pedidosOmie.length,
      criados,
      atualizados,
      duracao_ms: Date.now() - t0
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});