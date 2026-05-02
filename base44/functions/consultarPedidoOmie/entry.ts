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
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 4) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

function pedidoCancelado(pedido) {
  const texto = JSON.stringify(pedido || {}).toLowerCase();
  return texto.includes('cancelado') || texto.includes('cancelada');
}

// Consulta bruta de um pedido no Omie (retorna o objeto pedido_venda_produto completo)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, codigo_pedido_integracao } = body;
    if (!codigo_pedido && !codigo_pedido_integracao) {
      return Response.json({ error: 'codigo_pedido ou codigo_pedido_integracao obrigatório' }, { status: 400 });
    }

    const param = {};
    if (codigo_pedido) param.codigo_pedido = Number(codigo_pedido);
    if (codigo_pedido_integracao) param.codigo_pedido_integracao = String(codigo_pedido_integracao);

    const data = await omieCall('ConsultarPedido', param);
    const pedido = data.pedido_venda_produto;

    if (!pedido) return Response.json({ error: 'Pedido não retornado pelo Omie' }, { status: 404 });

    const cancelado = pedidoCancelado(pedido);
    pedido.cabecalho = {
      ...(pedido.cabecalho || {}),
      cancelado,
      status_pedido: cancelado ? 'cancelado' : (pedido.cabecalho?.status_pedido || pedido.cabecalho?.status || ''),
      etapa: cancelado ? 'cancelado' : pedido.cabecalho?.etapa
    };

    return Response.json({ sucesso: true, pedido });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});