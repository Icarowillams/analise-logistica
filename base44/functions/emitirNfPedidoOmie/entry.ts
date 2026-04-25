import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ENDPOINT CORRETO: pedidovendafat (Faturamento de Pedido de Venda) — diferente de /pedido/
const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_FAT_URL, {
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

// Dispara a emissão da NF-e via Omie usando FaturarPedidoVenda
// (endpoint /produtos/pedidovendafat/ — diferente do /produtos/pedido/).
// O Omie processa de forma assíncrona — a etapa só vai pra 60 quando a SEFAZ autorizar.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, codigo_pedido_integracao, validar_apenas = false } = body;

    if (!codigo_pedido && !codigo_pedido_integracao) {
      return Response.json({ error: 'Informe codigo_pedido ou codigo_pedido_integracao' }, { status: 400 });
    }

    // Parâmetros conforme doc Omie: nCodPed (integer) e cCodIntPed (string60)
    const param = {};
    if (codigo_pedido) param.nCodPed = Number(codigo_pedido);
    if (codigo_pedido_integracao) param.cCodIntPed = codigo_pedido_integracao;

    const callName = validar_apenas ? 'ValidarPedidoVenda' : 'FaturarPedidoVenda';
    const t0 = Date.now();
    let resposta;
    try {
      resposta = await omieCall(callName, param);
    } catch (e) {
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'produtos/pedidovendafat',
        call: callName,
        operacao: validar_apenas ? 'validar_nf' : 'emitir_nf',
        status: 'erro',
        duracao_ms: Date.now() - t0,
        mensagem_erro: e.message,
        payload_enviado: JSON.stringify(param).substring(0, 1500),
        usuario_email: user.email
      }).catch(() => {});
      return Response.json({ sucesso: false, error: e.message }, { status: 400 });
    }

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedidovendafat',
      call: callName,
      operacao: validar_apenas ? 'validar_nf' : 'emitir_nf',
      status: 'sucesso',
      duracao_ms: Date.now() - t0,
      payload_enviado: JSON.stringify(param).substring(0, 1500),
      payload_resposta: JSON.stringify(resposta).substring(0, 1500),
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      mensagem: resposta?.cDescStatus || 'Pedido enviado para emissão de NF-e. Aguarde alguns minutos para o Omie processar.',
      cCodStatus: resposta?.cCodStatus,
      cDescStatus: resposta?.cDescStatus,
      resposta
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});