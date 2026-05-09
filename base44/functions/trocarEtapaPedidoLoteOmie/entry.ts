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
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 4) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Troca etapa de vários pedidos em lote (usado pela Montagem de Carga: 20 → 50)
// body: { pedidos: [{ codigo_pedido, codigo_pedido_integracao, numero_pedido }], etapa_destino: "50" }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { pedidos = [], etapa_destino } = await req.json().catch(() => ({}));
    if (!etapa_destino) return Response.json({ error: 'etapa_destino obrigatória' }, { status: 400 });
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      return Response.json({ sucesso: true, resultados: [], total: 0 });
    }

    const resultados = [];
    for (const p of pedidos) {
      const cabecalho = { etapa: String(etapa_destino) };
      if (p.codigo_pedido) cabecalho.codigo_pedido = Number(p.codigo_pedido);
      if (p.codigo_pedido_integracao) cabecalho.codigo_pedido_integracao = String(p.codigo_pedido_integracao);

      try {
        const data = await omieCall('AlterarPedidoVenda', { cabecalho });
        const ok = data.cCodStatus === '0' || data.cCodStatus === 0;
        resultados.push({
          codigo_pedido: p.codigo_pedido,
          numero_pedido: p.numero_pedido,
          sucesso: ok,
          mensagem: data.cDescStatus || ''
        });
      } catch (e) {
        resultados.push({
          codigo_pedido: p.codigo_pedido,
          numero_pedido: p.numero_pedido,
          sucesso: false,
          mensagem: e.message
        });
      }
      await new Promise(r => setTimeout(r, 1200));
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.length - sucessos;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'AlterarPedidoVenda',
      operacao: `trocar_etapa_lote_${etapa_destino}`,
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} pedidos falharam` : null,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({ sucesso: true, total: pedidos.length, sucessos, erros, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});