import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Diagnóstico temporário: mostra a estrutura REAL da resposta ConsultarPedido do Omie
// para um pedido que está preso em nf_aguardando_autorizacao, para descobrir onde está
// a etapa real e o número da NF.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const numeroCarga = body.numero_carga || '378';

    const peds = body.codigo_omie
      ? [{ omie_codigo_pedido: String(body.codigo_omie), numero_pedido: 'manual' }]
      : await base44.asServiceRole.entities.Pedido.filter({ numero_carga: numeroCarga, nf_aguardando_autorizacao: true }, '-data_faturamento', 3).catch(() => []);
    if (peds.length === 0) return Response.json({ erro: 'nenhum pedido aguardando nessa carga' });

    const appSecret = Deno.env.get('OMIE_APP_SECRET') || '';
    let appKey = Deno.env.get('OMIE_APP_KEY') || '';
    if (!appKey) {
      const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
      appKey = rows?.[0]?.app_key || '';
    }

    // Já temos um pedido faturado conhecido (2542 = 11530415574). Testa ListarNF com vários parâmetros.
    const cod = Number(peds[0].omie_codigo_pedido);
    const out = {};

    // Tentativa A: ListarNF filtrando por código de pedido
    const respA = await fetch('https://app.omie.com.br/api/v1/produtos/nfconsultar/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ListarNF', app_key: appKey, app_secret: appSecret, param: [{ pagina: 1, registros_por_pagina: 5, apenas_importado_api: 'N', filtrar_por_cod_ped: cod }] })
    });
    const dataA = await respA.json();
    out.ListarNF_porCodPed = { http: respA.status, faultstring: dataA?.faultstring || null, total: dataA?.total_de_registros, primeira_nf: dataA?.nfCadastro?.[0] || dataA?.nf_cadastro?.[0] || null };

    await new Promise(r => setTimeout(r, 1000));

    // Tentativa B: ObterNF pelo código do pedido
    const respB = await fetch('https://app.omie.com.br/api/v1/produtos/nfconsultar/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ObterNF', app_key: appKey, app_secret: appSecret, param: [{ nCodPed: cod }] })
    });
    const dataB = await respB.json();
    out.ObterNF_nCodPed = { http: respB.status, faultstring: dataB?.faultstring || null, chaves: Object.keys(dataB || {}), amostra: JSON.stringify(dataB).slice(0, 800) };

    return Response.json({ codigo_testado: cod, pedido: peds[0].numero_pedido, resultados: out });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});