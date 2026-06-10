import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Corrige o espelho PedidoLiberadoOmie para pedidos de um dia específico,
// atualizando diretamente os registros divergentes sem chamar ConsultarPedido.
// Usa os dados já retornados pelo ListarPedidos.

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache = null;

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
  const tid = setTimeout(() => controller.abort(), 30000);
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
    if (!user || user.role !== 'admin') return Response.json({ error: 'Acesso negado — admin apenas' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { data_inicial, data_final, dry_run = false } = body;

    if (!data_inicial || !data_final) {
      return Response.json({ error: 'data_inicial e data_final obrigatórios (DD/MM/AAAA)' }, { status: 400 });
    }

    // Busca etapas informadas ou por padrão apenas a 60 (faturados) para não bater rate limit
    const etapas = body.etapas || ['60'];
    const todosPedidosOmie = [];

    // Busca uma etapa por vez com pausa generosa para respeitar rate limit
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
          const infoNfe = p.infoNfe || p.info_nf || null;
          const numeroNf = String(infoNfe?.nNF || infoNfe?.numero_nf || cab.numero_nfe || '');
          
          let statusReal = null;
          let statusLabel = null;
          if (etapa === '60') {
            if (infoNfe?.cStatus === 'AUTORIZADA' || infoNfe?.nNF) {
              statusReal = 'emitida';
              statusLabel = 'Faturado';
            } else {
              statusReal = 'aguardando_nf';
              statusLabel = 'Aguardando NF';
            }
          }

          todosPedidosOmie.push({
            codigo_pedido: String(cab.codigo_pedido || ''),
            numero_pedido: String(cab.numero_pedido || ''),
            etapa_omie: etapa,
            numero_nf: numeroNf,
            status_real: statusReal,
            status_label: statusLabel,
            data_faturamento: etapa === '60' ? (infoNfe?.dEmiNFe || null) : null,
            valor_total: p.total_pedido?.valor_total_pedido || 0,
          });
        }

        const totalPags = Number(data.total_de_paginas || 1);
        if (pagina >= totalPags || pagina >= 15) break;
        pagina++;
        await new Promise(r => setTimeout(r, 3000)); // pausa maior entre páginas
      }
      await new Promise(r => setTimeout(r, 5000)); // pausa maior entre etapas
    }

    // Buscar espelho local
    const espelho = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('-sincronizado_em', 5000);
    const espelhoPorCodigo = new Map(espelho.map(e => [String(e.codigo_pedido), e]));

    let atualizados = 0;
    let ignorados = 0;
    const detalhes = [];
    const pendentes = [];

    for (const omie of todosPedidosOmie) {
      const esp = espelhoPorCodigo.get(omie.codigo_pedido);
      if (!esp) { ignorados++; continue; }
      
      const etapaAtual = esp.etapa;
      if (etapaAtual === omie.etapa_omie) { ignorados++; continue; }

      // Protege: não retrocede etapa 60 para etapa menor (ex: se espelho já está em 60, não volta para 50)
      const etapaNumerica = parseInt(omie.etapa_omie);
      const etapaAtualNumerica = parseInt(etapaAtual || '0');
      if (etapaAtualNumerica > etapaNumerica) {
        ignorados++;
        detalhes.push({ numero: omie.numero_pedido, motivo: `protegido (espelho ${etapaAtual} > omie ${omie.etapa_omie})` });
        continue;
      }

      detalhes.push({ numero: omie.numero_pedido, de: etapaAtual, para: omie.etapa_omie, nf: omie.numero_nf });

      if (!dry_run) {
        // coloca na fila para processar em lote depois
        pendentes.push({ omie, esp });
      }

      atualizados++;
    }

    // Processa em lotes de 5 com pausa de 500ms entre cada
    if (!dry_run && pendentes.length > 0) {
      const LOTE = 5;
      for (let i = 0; i < pendentes.length; i += LOTE) {
        const lote = pendentes.slice(i, i + LOTE);
        await Promise.all(lote.map(async ({ omie, esp }) => {
          const update = {
            etapa: omie.etapa_omie,
            sincronizado_em: new Date().toISOString(),
            origem_sync: 'reconciliacao'
          };
          if (omie.status_real) update.status_real = omie.status_real;
          if (omie.status_label) update.status_label = omie.status_label;
          if (omie.numero_nf) update.numero_nf = omie.numero_nf;
          if (omie.data_faturamento) update.data_faturamento = omie.data_faturamento;
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, update);

          if (omie.etapa_omie === '60' && esp.pedido_id) {
            await base44.asServiceRole.entities.Pedido.update(esp.pedido_id, {
              status: 'faturado',
              faturado: true,
              status_faturamento: 'faturado',
              ...(omie.numero_nf ? { numero_nota_fiscal: omie.numero_nf } : {}),
              data_faturamento: omie.data_faturamento || new Date().toISOString()
            }).catch(() => {});
          }
        }));
        if (i + LOTE < pendentes.length) await new Promise(r => setTimeout(r, 500));
      }
    }

    return Response.json({
      sucesso: true,
      dry_run,
      total_omie: todosPedidosOmie.length,
      atualizados,
      ignorados,
      detalhes: detalhes.slice(0, 100)
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});