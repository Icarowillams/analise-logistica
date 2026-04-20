import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
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
    const { codigo_pedido, codigo_pedido_integracao, etapa } = body;

    if (!etapa) return Response.json({ error: 'etapa obrigatória' }, { status: 400 });
    if (!codigo_pedido && !codigo_pedido_integracao) {
      return Response.json({ error: 'Informe codigo_pedido ou codigo_pedido_integracao' }, { status: 400 });
    }

    const cabecalho = { etapa: String(etapa) };
    if (codigo_pedido) cabecalho.codigo_pedido = Number(codigo_pedido);
    if (codigo_pedido_integracao) cabecalho.codigo_pedido_integracao = codigo_pedido_integracao;

    const t0 = Date.now();
    const data = await omieCall('AlterarPedidoVenda', { cabecalho });
    const duracao = Date.now() - t0;

    const sucesso = data.cCodStatus === '0' || data.cCodStatus === 0;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'AlterarPedidoVenda',
      operacao: 'trocar_etapa',
      status: sucesso ? 'sucesso' : 'erro',
      duracao_ms: duracao,
      mensagem_erro: sucesso ? null : (data.cDescStatus || 'erro desconhecido'),
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({ sucesso, resposta: data });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});