import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

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
    const isTransient = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante')
      || msg.includes('limite de requisi') || msg.includes('internal error') || msg.includes('timeout') || msg.includes('indispon')
      || fc.includes('425') || fc.includes('520') || res.status === 429;
    if (isTransient && tentativa < 4) {
      await new Promise(r => setTimeout(r, 2000 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
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
    const {
      data_inicial,
      data_final,
      pagina = 1,
      registros_por_pagina = 100,
      nome_cliente,
      cnpj_cliente
    } = body;

    // Doc Omie: máx 100 registros/página
    const param = { pagina, registros_por_pagina: Math.min(registros_por_pagina, 100) };
    if (data_inicial) param.dEmiInicial = data_inicial;
    if (data_final) param.dEmiFinal = data_final;
    if (nome_cliente) param.cRazao = nome_cliente;
    if (cnpj_cliente) param.cCPFCNPJDest = cnpj_cliente.replace(/\D/g, '');

    const t0 = Date.now();
    const data = await omieCall('ListarNF', param);
    const duracao = Date.now() - t0;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/nfconsultar',
      call: 'ListarNF',
      operacao: 'listar_nfs',
      status: 'sucesso',
      duracao_ms: duracao,
      usuario_email: user.email
    }).catch(() => {});

    const nfs = (data.nfCadastro || []).map(nf => ({
      nIdNF: nf.compl?.nIdNF || nf.nIdNF,
      nIdPedido: nf.compl?.nIdPedido || nf.nIdPedido,
      cNumero: nf.ide?.nNF || nf.cNumero,
      cSerie: nf.ide?.serie || nf.cSerie,
      cChaveNFe: nf.compl?.cChaveNFe || nf.cChaveNFe,
      dEmiNF: nf.ide?.dEmi || nf.dEmiNF,
      cRazao: nf.nfDestInt?.cRazao || nf.cRazao,
      cCPFCNPJDest: nf.nfDestInt?.cnpj_cpf || nf.cCPFCNPJDest,
      nValorNF: nf.total?.ICMSTot?.vNF || nf.nValorNF,
      cStatus: nf.ide?.cStat || nf.cStatus,
      cOperacao: nf.ide?.cNatOp || nf.cOperacao
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