import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache = null;
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  const appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function omieCall(base44, endpoint, param, call) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const url = OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 20000);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
    signal: controller.signal
  });
  clearTimeout(tid);
  const data = await res.json();
  if (data.faultstring) {
    if (/n[ãa]o existem registros/i.test(data.faultstring)) return null;
    throw new Error(data.faultstring);
  }
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { data_inicial, data_final } = body;

    if (!data_inicial || !data_final) {
      return Response.json({ error: 'data_inicial e data_final são obrigatórios (DD/MM/AAAA)' }, { status: 400 });
    }

    const etapas = ['10', '20', '50', '60'];
    const etapaLabels = { '10': 'Novo', '20': 'Liberado', '50': 'Faturar', '60': 'Faturado' };
    const todosPedidosOmie = [];

    for (const etapa of etapas) {
      let pagina = 1;
      while (true) {
        const data = await omieCall(base44, 'produtos/pedido/', {
          pagina,
          registros_por_pagina: 100,
          apenas_importado_api: 'N',
          etapa,
          filtrar_por_data_de: data_inicial,
          filtrar_por_data_ate: data_final
        }, 'ListarPedidos');

        if (!data) break;

        for (const p of (data.pedido_venda_produto || [])) {
          const cab = p.cabecalho || {};
          todosPedidosOmie.push({
            codigo_pedido: String(cab.codigo_pedido || ''),
            numero_pedido: String(cab.numero_pedido || ''),
            etapa_omie: etapa,
            etapa_label: etapaLabels[etapa],
            codigo_cliente: String(cab.codigo_cliente || ''),
            cliente_nome: cab.razao_social || cab.nome_fantasia || '',
            data_previsao: cab.data_previsao || '',
            valor_total: p.total_pedido?.valor_total_pedido || 0,
            numero_nf: p.infoCadastro?.numero_nf || cab.numero_nfe || ''
          });
        }

        const totalPags = Number(data.total_de_paginas || 1);
        if (pagina >= totalPags || pagina >= 15) break;
        pagina++;
        await new Promise(r => setTimeout(r, 1500));
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    // Buscar espelho local para cruzamento
    const espelho = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('-sincronizado_em', 5000);
    const espelhoPorCodigo = new Map(espelho.map(e => [String(e.codigo_pedido), e]));

    // Buscar pedidos locais
    const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({ omie_enviado: true }, '-created_date', 3000);
    const localPorCodigo = new Map();
    for (const p of pedidosLocais) {
      if (p.omie_codigo_pedido) localPorCodigo.set(String(p.omie_codigo_pedido), p);
    }

    // Cruzar
    const resultado = todosPedidosOmie.map(omie => {
      const esp = espelhoPorCodigo.get(omie.codigo_pedido);
      const local = localPorCodigo.get(omie.codigo_pedido);
      const etapaEspelho = esp?.etapa || null;
      const statusLocal = local?.status || null;
      const divergente = esp && etapaEspelho !== omie.etapa_omie;

      return {
        numero_pedido: omie.numero_pedido,
        codigo_pedido: omie.codigo_pedido,
        cliente_nome: omie.cliente_nome,
        etapa_omie: omie.etapa_omie,
        etapa_label: omie.etapa_label,
        etapa_espelho: etapaEspelho,
        status_local: statusLocal,
        numero_nf_omie: omie.numero_nf,
        numero_nf_espelho: esp?.numero_nf || null,
        valor_total: omie.valor_total,
        tem_espelho: !!esp,
        tem_local: !!local,
        divergente,
      };
    });

    const divergentes = resultado.filter(r => r.divergente);
    const semEspelho = resultado.filter(r => !r.tem_espelho);
    const ok = resultado.filter(r => r.tem_espelho && !r.divergente);

    return Response.json({
      sucesso: true,
      data_inicial,
      data_final,
      total_omie: todosPedidosOmie.length,
      resumo_etapas: etapas.reduce((acc, e) => {
        acc[e] = resultado.filter(r => r.etapa_omie === e).length;
        return acc;
      }, {}),
      divergentes: divergentes.length,
      sem_espelho: semEspelho.length,
      ok: ok.length,
      pedidos: resultado
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});