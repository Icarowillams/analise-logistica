import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

async function omieCall(url, call, param, tentativa = 1) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = data.faultstring.toLowerCase();
    const isRateLimit = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRateLimit && tentativa < 4) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(url, call, param, tentativa + 1);
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
    const { nIdNF, nIdPedido, chave } = body;

    if (!nIdNF && !nIdPedido && !chave) {
      return Response.json({ error: 'Informe nIdNF, nIdPedido ou chave' }, { status: 400 });
    }

    const paramBase = {};
    if (nIdNF) paramBase.nIdNF = nIdNF;
    if (nIdPedido) paramBase.nIdPedido = nIdPedido;
    if (chave) paramBase.cChaveNFe = chave;

    const t0 = Date.now();

    const [detalheRes, danfeRes, xmlRes] = await Promise.allSettled([
      omieCall('https://app.omie.com.br/api/v1/produtos/nfconsultar/', 'ConsultarNF', paramBase),
      omieCall('https://app.omie.com.br/api/v1/produtos/dfedocs/', 'ObterUrlDanfe', paramBase),
      omieCall('https://app.omie.com.br/api/v1/produtos/dfedocs/', 'ObterUrlNfe', paramBase)
    ]);

    const duracao = Date.now() - t0;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/nfconsultar + dfedocs',
      call: 'ConsultarNF + ObterUrlDanfe + ObterUrlNfe',
      operacao: 'detalhe_nota',
      status: 'sucesso',
      duracao_ms: duracao,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      detalhe: detalheRes.status === 'fulfilled' ? detalheRes.value : null,
      danfe_url: danfeRes.status === 'fulfilled' ? danfeRes.value?.cUrl : null,
      xml_url: xmlRes.status === 'fulfilled' ? xmlRes.value?.cUrl : null,
      erros: {
        detalhe: detalheRes.status === 'rejected' ? detalheRes.reason.message : null,
        danfe: danfeRes.status === 'rejected' ? danfeRes.reason.message : null,
        xml: xmlRes.status === 'rejected' ? xmlRes.reason.message : null
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});