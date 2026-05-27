import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

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

async function trocarUmPedido(pedido, etapaDestino) {
  const etapa = String(pedido.etapa || etapaDestino || '');
  if (!etapa) return { sucesso: false, mensagem: 'etapa obrigatória', ...pedido };
  if (!pedido.codigo_pedido && !pedido.codigo_pedido_integracao) {
    return { sucesso: false, mensagem: 'Informe codigo_pedido ou codigo_pedido_integracao', ...pedido };
  }

  const param = { etapa };
  if (pedido.codigo_pedido) param.codigo_pedido = Number(pedido.codigo_pedido);
  if (pedido.codigo_pedido_integracao) param.codigo_pedido_integracao = String(pedido.codigo_pedido_integracao);

  try {
    const resposta = await omieCall('TrocarEtapaPedido', param);
    await new Promise(r => setTimeout(r, 1200));
    return {
      codigo_pedido: pedido.codigo_pedido,
      codigo_pedido_integracao: pedido.codigo_pedido_integracao,
      numero_pedido: pedido.numero_pedido,
      etapa,
      sucesso: true,
      resposta
    };
  } catch (e) {
    return {
      codigo_pedido: pedido.codigo_pedido,
      codigo_pedido_integracao: pedido.codigo_pedido_integracao,
      numero_pedido: pedido.numero_pedido,
      etapa,
      sucesso: false,
      mensagem: e.message
    };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const pedidos = Array.isArray(body.pedidos) ? body.pedidos : null;

    if (pedidos) {
      const resultados = [];
      for (const pedido of pedidos) {
        resultados.push(await trocarUmPedido(pedido, body.etapa_destino));
      }
      const sucessos = resultados.filter(r => r.sucesso).length;
      const erros = resultados.length - sucessos;
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'produtos/pedido',
        call: 'TrocarEtapaPedido',
        operacao: `trocar_etapa_lote_${body.etapa_destino || 'multi'}`,
        status: erros > 0 ? 'warning' : 'sucesso',
        mensagem_erro: erros > 0 ? `${erros} pedidos falharam` : null,
        usuario_email: user.email
      }).catch(() => {});
      return Response.json({ sucesso: true, total: pedidos.length, sucessos, erros, resultados });
    }

    const resultado = await trocarUmPedido(body, body.etapa);
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'TrocarEtapaPedido',
      operacao: 'trocar_etapa',
      status: resultado.sucesso ? 'sucesso' : 'erro',
      mensagem_erro: resultado.sucesso ? null : resultado.mensagem,
      payload_enviado: JSON.stringify(body).substring(0, 1500),
      payload_resposta: JSON.stringify(resultado).substring(0, 1500),
      usuario_email: user.email
    }).catch(() => {});

    if (!resultado.sucesso) return Response.json({ sucesso: false, error: resultado.mensagem, resultado }, { status: 400 });
    return Response.json(resultado);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});