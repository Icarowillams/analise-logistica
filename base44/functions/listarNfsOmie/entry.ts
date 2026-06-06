import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

async function resolverCreds(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  return {
    app_key: ativo?.app_key || Deno.env.get('OMIE_APP_KEY'),
    app_secret: ativo?.app_secret || Deno.env.get('OMIE_APP_SECRET')
  };
}

async function omieCall(base44, call, param) {
  const { app_key, app_secret } = await resolverCreds(base44);
  if (!app_key || !app_secret) throw new Error('Credenciais Omie não configuradas.');

  const url = OMIE_BASE_URL + 'produtos/nfconsultar/';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key, app_secret, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) throw new Error(data.faultstring);
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      data_inicial,
      data_final,
      pagina = 1,
      registros_por_pagina = 100,
      nome_cliente,
      cnpj_cliente
    } = body;

    const param = { pagina, registros_por_pagina: Math.min(registros_por_pagina, 100) };
    if (data_inicial) param.dEmiInicial = data_inicial;
    if (data_final) param.dEmiFinal = data_final;
    if (nome_cliente) param.cRazao = nome_cliente;
    if (cnpj_cliente) param.cCPFCNPJDest = cnpj_cliente.replace(/\D/g, '');

    const t0 = Date.now();
    const data = await omieCall(base44, 'ListarNF', param);
    const duracao = Date.now() - t0;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/nfconsultar',
      call: 'ListarNF',
      operacao: 'listar_nfs',
      status: 'sucesso',
      duracao_ms: duracao,
      usuario_email: user.email
    }).catch(() => {});

    const derivarStatus = (nf) => {
      const ide = nf.ide || {};
      const compl = nf.compl || {};
      const nfStatus = nf.nfStatus || {};
      const cStat = String(nfStatus.cStat || compl.cStat || '').trim();

      if (cStat) {
        if (cStat === '101') return 'cancelada';
        if (cStat === '102') return 'inutilizada';
        if (cStat === '110' || cStat === '301' || cStat === '302') return 'denegada';
        if (cStat === '100' || cStat === '135') return 'autorizada';
        return 'rejeitada';
      }

      if (ide.dCan && String(ide.dCan).trim()) return 'cancelada';
      if (ide.cDeneg === 'S' || ide.cDeneg === 'D') return 'denegada';
      if (ide.dInut && String(ide.dInut).trim()) return 'inutilizada';
      if (compl.cChaveNFe && String(compl.cChaveNFe).length >= 40) return 'autorizada';
      return 'pendente';
    };

    const nfs = (data.nfCadastro || []).map(nf => ({
      nIdNF: nf.compl?.nIdNF || nf.nIdNF || nf.nCodNF,
      nCodNF: nf.compl?.nIdNF || nf.nIdNF || nf.nCodNF,
      nIdPedido: nf.compl?.nIdPedido || nf.nIdPedido,
      cNumero: nf.ide?.nNF || nf.cNumero,
      cSerie: nf.ide?.serie || nf.cSerie,
      cChaveNFe: nf.compl?.cChaveNFe || nf.cChaveNFe,
      dEmiNF: nf.ide?.dEmi || nf.dEmiNF,
      hEmiNF: nf.ide?.hEmi || nf.hEmiNF,
      dCanNF: nf.ide?.dCan || null,
      dInutNF: nf.ide?.dInut || null,
      cDeneg: nf.ide?.cDeneg || null,
      cRazao: nf.nfDestInt?.cRazao || nf.cRazao,
      cNomeFantasia: nf.nfDestInt?.cNomeFantasia || nf.nfDestInt?.nome_fantasia || '',
      cCPFCNPJDest: nf.nfDestInt?.cnpj_cpf || nf.cCPFCNPJDest,
      nValorNF: nf.total?.ICMSTot?.vNF || nf.nValorNF,
      cStatus: derivarStatus(nf),
      cOperacao: nf.ide?.cNatOp || nf.cOperacao,
      itens: nf.det || [],
      total: nf.total || null,
      nf_raw: nf
    }));

    return Response.json({
      sucesso: true,
      nfs,
      pagina: data.nPagina || data.pagina,
      total_de_paginas: data.nTotPaginas || data.total_de_paginas,
      total_de_registros: data.nRegistros || data.total_de_registros
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});