import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache = null;
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

async function omieCall(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  for (let i = 0; i <= 2; i++) {
    try {
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
        const msg = String(data.faultstring).toLowerCase();
        if (msg.includes('não existem registros') || msg.includes('nao existem registros')) return null;
        if (i < 2 && (msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout'))) {
          await new Promise(r => setTimeout(r, [2000, 4000][i]));
          continue;
        }
        throw new Error(data.faultstring);
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') e.message = 'Timeout';
      if (i < 2 && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, [2000, 4000][i])); continue; }
      throw e;
    }
  }
}

async function buscarPedidosEtapa(base44, etapa, dataInicial, dataFinal) {
  const pedidos = [];
  let pagina = 1;
  while (true) {
    const param = {
      pagina,
      registros_por_pagina: 100,
      apenas_importado_api: 'N',
      etapa: String(etapa)
    };
    if (dataInicial) param.filtrar_por_data_de = dataInicial;
    if (dataFinal) param.filtrar_por_data_ate = dataFinal;

    const data = await omieCall(base44, 'produtos/pedido/', param, { call: 'ListarPedidos' });
    if (!data) break;

    const items = data.pedido_venda_produto || [];
    for (const p of items) {
      const cab = p.cabecalho || {};
      pedidos.push({
        codigo_pedido: String(cab.codigo_pedido || ''),
        codigo_pedido_integracao: cab.codigo_pedido_integracao || '',
        numero_pedido: String(cab.numero_pedido || ''),
        etapa_omie: String(etapa),
        codigo_cliente: String(cab.codigo_cliente || ''),
        cliente_nome: cab.razao_social || cab.nome_fantasia || '',
        valor_total: p.total_pedido?.valor_total_pedido || 0,
        numero_nf: p.infoCadastro?.numero_nf || cab.numero_nfe || '',
        data_previsao: cab.data_previsao || ''
      });
    }

    const totalPags = Number(data.total_de_paginas || 1);
    if (pagina >= totalPags || pagina >= 20) break;
    pagina++;
    await new Promise(r => setTimeout(r, 500)); // respeitar rate limit
  }
  return pedidos;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Acesso negado' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { data_inicial, data_final } = body;

    // 1. Buscar pedidos no Omie em todas as etapas relevantes
    const etapas = ['10', '20', '50', '60'];
    const etapaLabels = { '10': 'Novo', '20': 'Liberados', '50': 'Faturar', '60': 'Faturado' };

    const resultadoOmie = {};
    const todosPedidosOmie = [];

    for (const etapa of etapas) {
      const pedidos = await buscarPedidosEtapa(base44, etapa, data_inicial, data_final);
      resultadoOmie[etapa] = pedidos;
      todosPedidosOmie.push(...pedidos);
      await new Promise(r => setTimeout(r, 800)); // pausa entre etapas
    }

    // 2. Buscar pedidos locais (Base44) com omie_enviado = true
    const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({ omie_enviado: true }, '-created_date', 2000);

    // 3. Buscar espelho PedidoLiberadoOmie
    const espelho = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('-sincronizado_em', 5000);

    // Indexar pedidos locais por codigo_pedido_omie e número
    const localPorCodigoOmie = {};
    const localPorNumero = {};
    for (const p of pedidosLocais) {
      if (p.omie_codigo_pedido) localPorCodigoOmie[String(p.omie_codigo_pedido).trim()] = p;
      if (p.numero_pedido) localPorNumero[String(p.numero_pedido).trim()] = p;
    }

    // Indexar espelho por codigo_pedido
    const espelhoPorCodigo = {};
    for (const e of espelho) {
      if (e.codigo_pedido) espelhoPorCodigo[String(e.codigo_pedido).trim()] = e;
    }

    // 4. Cruzamento: para cada pedido Omie, verificar status no local
    const divergencias = [];
    const coincidentes = [];

    for (const pedidoOmie of todosPedidosOmie) {
      const cod = pedidoOmie.codigo_pedido;
      const localMatch = localPorCodigoOmie[cod];
      const espelhoMatch = espelhoPorCodigo[cod];

      // Determinar etapa no espelho local
      const etapaEspelho = espelhoMatch?.etapa || null;
      const etapaOmie = pedidoOmie.etapa_omie;

      if (!localMatch && !espelhoMatch) {
        divergencias.push({
          tipo: 'SEM_ESPELHO_LOCAL',
          descricao: 'Pedido existe no Omie mas não tem espelho local',
          codigo_pedido: cod,
          numero_pedido: pedidoOmie.numero_pedido,
          etapa_omie: etapaOmie,
          etapa_local: null,
          cliente_nome: pedidoOmie.cliente_nome,
          valor_total: pedidoOmie.valor_total
        });
      } else if (espelhoMatch && etapaEspelho !== etapaOmie) {
        divergencias.push({
          tipo: 'ETAPA_DIVERGENTE',
          descricao: `Omie: etapa ${etapaOmie} (${etapaLabels[etapaOmie] || etapaOmie}) | Espelho local: etapa ${etapaEspelho}`,
          codigo_pedido: cod,
          numero_pedido: pedidoOmie.numero_pedido,
          etapa_omie: etapaOmie,
          etapa_local: etapaEspelho,
          cliente_nome: pedidoOmie.cliente_nome,
          valor_total: pedidoOmie.valor_total
        });
      } else {
        coincidentes.push({
          codigo_pedido: cod,
          numero_pedido: pedidoOmie.numero_pedido,
          etapa_omie: etapaOmie,
          etapa_local: etapaEspelho,
          cliente_nome: pedidoOmie.cliente_nome,
          valor_total: pedidoOmie.valor_total
        });
      }
    }

    // 5. Pedidos locais com omie_enviado=true que NÃO aparecem no Omie
    const codigosOmie = new Set(todosPedidosOmie.map(p => p.codigo_pedido));
    const pedidosLocaisSemOmie = pedidosLocais.filter(p => {
      const cod = p.omie_codigo_pedido ? String(p.omie_codigo_pedido).trim() : null;
      return cod && !codigosOmie.has(cod) && !['cancelado', 'faturado'].includes(p.status);
    }).map(p => ({
      tipo: 'LOCAL_SEM_OMIE',
      descricao: 'Pedido local marcado como enviado ao Omie, mas não encontrado nas etapas ativas',
      codigo_pedido: p.omie_codigo_pedido,
      numero_pedido: p.numero_pedido,
      status_local: p.status,
      etapa_local: espelhoPorCodigo[String(p.omie_codigo_pedido || '')]?.etapa || null,
      cliente_nome: p.cliente_nome,
      valor_total: p.valor_total
    }));

    // Resumo por etapa
    const resumoEtapas = {};
    for (const etapa of etapas) {
      resumoEtapas[etapa] = {
        label: etapaLabels[etapa],
        total_omie: resultadoOmie[etapa].length,
        com_espelho_correto: resultadoOmie[etapa].filter(p => espelhoPorCodigo[p.codigo_pedido]?.etapa === etapa).length,
        sem_espelho: resultadoOmie[etapa].filter(p => !espelhoPorCodigo[p.codigo_pedido]).length,
        etapa_divergente: resultadoOmie[etapa].filter(p => espelhoPorCodigo[p.codigo_pedido] && espelhoPorCodigo[p.codigo_pedido].etapa !== etapa).length
      };
    }

    return Response.json({
      sucesso: true,
      gerado_em: new Date().toISOString(),
      resumo: {
        total_omie: todosPedidosOmie.length,
        total_local_enviado: pedidosLocais.length,
        total_espelho: espelho.length,
        coincidentes: coincidentes.length,
        divergencias: divergencias.length,
        locais_sem_omie: pedidosLocaisSemOmie.length
      },
      resumo_etapas: resumoEtapas,
      divergencias: divergencias.slice(0, 200),
      locais_sem_omie: pedidosLocaisSemOmie.slice(0, 100),
      coincidentes_sample: coincidentes.slice(0, 50)
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});