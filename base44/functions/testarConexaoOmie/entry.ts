import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const appKey = Deno.env.get('OMIE_APP_KEY');
    const appSecret = Deno.env.get('OMIE_APP_SECRET');

    if (!appKey || !appSecret) {
      return Response.json({
        ok: false,
        error: 'OMIE_APP_KEY ou OMIE_APP_SECRET não configurados nos secrets.'
      }, { status: 400 });
    }

    const startedAt = Date.now();
    // Teste: chamar ListarEmpresas (endpoint leve que valida credenciais)
    const res = await fetch(`${OMIE_BASE_URL}geral/empresas/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarEmpresas',
        app_key: appKey,
        app_secret: appSecret,
        param: [{ pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N' }]
      })
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    const duracao_ms = Date.now() - startedAt;

    // Log
    const sucesso = !json.faultstring && !json.faultcode;
    try {
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'geral/empresas',
        call: 'ListarEmpresas',
        operacao: 'testar_conexao',
        status: sucesso ? 'sucesso' : 'erro',
        codigo_erro: json.faultcode,
        mensagem_erro: json.faultstring,
        payload_resposta: JSON.stringify(json).slice(0, 2000),
        duracao_ms,
        tentativas: 1,
        usuario_email: user.email
      });
    } catch (_) {}

    if (!sucesso) {
      return Response.json({
        ok: false,
        error: json.faultstring || 'Falha desconhecida',
        code: json.faultcode,
        duracao_ms
      });
    }

    // Extrai info básica da empresa
    const empresa = json.empresas_cadastro?.[0] || {};
    return Response.json({
      ok: true,
      duracao_ms,
      empresa: {
        razao_social: empresa.razao_social,
        cnpj: empresa.cnpj,
        nome_fantasia: empresa.nome_fantasia
      },
      total_empresas: json.total_de_registros || 0
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});