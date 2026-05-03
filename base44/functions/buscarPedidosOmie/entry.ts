import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET');

// Doc Omie: backoff em rate limit (425), erros transientes (520) e 429
async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const fc = String(data.faultcode || '');
    const bloqueio = msg.includes('bloqueada por consumo indevido');
    const isTransient = !bloqueio && (msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante')
      || msg.includes('limite de requisi') || msg.includes('internal error') || msg.includes('timeout') || msg.includes('indispon')
      || fc.includes('425') || fc.includes('520') || res.status === 429);
    if (isTransient && tentativa < 3) {
      await new Promise(r => setTimeout(r, 2500 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function pedidoCancelado(pedido) {
  const cab = pedido?.cabecalho || {};
  const info = [cab.cancelado, cab.status_pedido, cab.status, cab.etapa, cab.descricao_status]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return cab.cancelado === 'S' || info.includes('cancelado') || info.includes('cancelada');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      etapa = '50',
      data_inicial,
      data_final,
      pagina = 1,
      registros_por_pagina = 100,
      apenas_faturar = false,
      incluir_cancelados = false,
      buscar_todas_paginas = false,
      max_paginas = 10
    } = body;

    // Doc Omie: máx 100 registros/página
    const param = {
      pagina,
      registros_por_pagina: Math.min(registros_por_pagina, 100),
      apenas_importado_api: 'N'
    };
    if (etapa) param.etapa = String(etapa);
    if (data_inicial) param.filtrar_por_data_de = data_inicial;
    if (data_final) param.filtrar_por_data_ate = data_final;
    if (apenas_faturar) param.filtrar_apenas_ab_pedidos = 'S';

    const t0 = Date.now();
    let data;
    let todosPedidosOmie = [];
    try {
      data = await omieCall('ListarPedidos', param);
      todosPedidosOmie = data.pedido_venda_produto || [];

      if (buscar_todas_paginas) {
        const totalPaginas = Math.min(Number(data.total_de_paginas || 1), Number(max_paginas || 10));
        for (let pag = 2; pag <= totalPaginas; pag++) {
          await delay(900);
          const paginaData = await omieCall('ListarPedidos', { ...param, pagina: pag });
          todosPedidosOmie.push(...(paginaData.pedido_venda_produto || []));
        }
      }
    } catch (e) {
      // Omie retorna erro quando não há registros — tratar como lista vazia
      if (/n[ãa]o existem registros/i.test(e.message)) {
        return Response.json({ sucesso: true, pedidos: [], pagina: pagina, total_de_paginas: 0, total_de_registros: 0, registros: 0 });
      }
      if (/bloqueada por consumo indevido|consumo redundante|aguarde/i.test(e.message)) {
        return Response.json({ sucesso: false, pedidos: [], error: e.message, bloqueado_omie: true }, { status: 429 });
      }
      throw e;
    }
    const duracao = Date.now() - t0;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'ListarPedidos',
      operacao: 'buscar_pedidos_logistica',
      status: 'sucesso',
      duracao_ms: duracao,
      usuario_email: user.email
    }).catch(() => {});

    const pedidos = todosPedidosOmie
      .filter(p => incluir_cancelados || !pedidoCancelado(p))
      .map(p => {
        const cancelado = pedidoCancelado(p);
        return {
          codigo_pedido: String(p.cabecalho?.codigo_pedido || ''),
          codigo_pedido_integracao: p.cabecalho?.codigo_pedido_integracao || '',
          numero_pedido: p.cabecalho?.numero_pedido || '',
          codigo_cliente: String(p.cabecalho?.codigo_cliente || ''),
          data_previsao: p.cabecalho?.data_previsao || '',
          etapa: cancelado ? 'cancelado' : (p.cabecalho?.etapa || ''),
          status_pedido: cancelado ? 'cancelado' : (p.cabecalho?.status_pedido || p.cabecalho?.status || ''),
          cancelado,
          valor_total_pedido: p.total_pedido?.valor_total_pedido || 0,
          quantidade_itens: (p.det || []).length,
          produtos: (p.det || []).map(d => ({
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

    return Response.json({
      sucesso: true,
      pedidos,
      pagina: data.pagina,
      total_de_paginas: data.total_de_paginas,
      total_de_registros: data.total_de_registros,
      registros: pedidos.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});