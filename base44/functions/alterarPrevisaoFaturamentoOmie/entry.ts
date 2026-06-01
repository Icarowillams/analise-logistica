import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

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

// Converte "YYYY-MM-DD" → "DD/MM/YYYY"
function toOmieDate(iso) {
  if (!iso) return '';
  if (iso.includes('/')) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Atualiza data_previsao de vários pedidos no Omie (AlterarPedidoVenda só com cabecalho)
// body: { pedidos: [{ codigo_pedido, codigo_pedido_integracao, numero_pedido }], data_previsao: "YYYY-MM-DD" | "DD/MM/YYYY" }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { pedidos = [], data_previsao } = await req.json().catch(() => ({}));
    if (!data_previsao) return Response.json({ error: 'data_previsao obrigatória' }, { status: 400 });
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      return Response.json({ sucesso: true, resultados: [], total: 0 });
    }

    const dataOmie = toOmieDate(data_previsao);
    const resultados = [];

    for (const p of pedidos) {
      const cabecalho = { data_previsao: dataOmie };
      if (p.codigo_pedido) cabecalho.codigo_pedido = Number(p.codigo_pedido);
      if (p.codigo_pedido_integracao) cabecalho.codigo_pedido_integracao = String(p.codigo_pedido_integracao);

      try {
        const data = await omieCall('AlterarPedidoVenda', { cabecalho });
        const ok = data.cCodStatus === '0' || data.cCodStatus === 0;

        if (ok && p.codigo_pedido) {
          const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
            { codigo_pedido: String(p.codigo_pedido) },
            '-created_date',
            1
          );
          if (espelhos?.[0]) {
            await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
              data_previsao: data_previsao,
              sincronizado_em: new Date().toISOString()
            });
          }
        }

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
      operacao: 'alterar_previsao_lote',
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} pedidos falharam` : null,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({ sucesso: true, total: pedidos.length, sucessos, erros, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});