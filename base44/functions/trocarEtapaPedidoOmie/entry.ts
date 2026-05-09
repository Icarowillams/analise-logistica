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

    const param = { etapa: String(etapa) };
    if (codigo_pedido) param.codigo_pedido = Number(codigo_pedido);
    if (codigo_pedido_integracao) param.codigo_pedido_integracao = codigo_pedido_integracao;

    const t0 = Date.now();
    const respostaTroca = await omieCall('TrocarEtapaPedido', param);

    // Aguarda 1.5s para o Omie indexar a mudança e VALIDA consultando o pedido
    await new Promise(r => setTimeout(r, 1500));
    let etapaReal = null;
    let validacaoErro = null;
    try {
      const consulta = await omieCall('ConsultarPedido', codigo_pedido
        ? { codigo_pedido: Number(codigo_pedido) }
        : { codigo_pedido_integracao });
      etapaReal = consulta?.pedido_venda_produto?.cabecalho?.etapa
        || consulta?.cabecalho?.etapa
        || null;
    } catch (e) {
      validacaoErro = e.message;
    }

    const duracao = Date.now() - t0;
    const sucesso = etapaReal === String(etapa);

    let mensagemErro = null;
    if (!sucesso) {
      if (validacaoErro) {
        mensagemErro = `Falha ao validar etapa: ${validacaoErro}`;
      } else if (etapaReal) {
        mensagemErro = `Omie retornou OK, mas pedido permaneceu na etapa ${etapaReal} (esperado ${etapa}). Pode haver bloqueio fiscal/financeiro.`;
      } else {
        mensagemErro = 'Não foi possível confirmar a troca de etapa no Omie.';
      }
    }

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'TrocarEtapaPedido',
      operacao: 'trocar_etapa',
      status: sucesso ? 'sucesso' : 'erro',
      duracao_ms: duracao,
      mensagem_erro: mensagemErro,
      payload_enviado: JSON.stringify(param).substring(0, 1500),
      payload_resposta: JSON.stringify({ resposta_troca: respostaTroca, etapa_real: etapaReal }).substring(0, 1500),
      usuario_email: user.email
    }).catch(() => {});

    if (!sucesso) {
      return Response.json({
        sucesso: false,
        error: mensagemErro,
        etapa_solicitada: String(etapa),
        etapa_real: etapaReal,
        resposta: respostaTroca
      }, { status: 400 });
    }

    return Response.json({ sucesso: true, etapa_real: etapaReal, resposta: respostaTroca });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});