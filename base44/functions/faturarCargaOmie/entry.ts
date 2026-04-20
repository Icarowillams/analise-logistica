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

// Fatura uma carga: muda etapa de cada pedido da etapa atual → etapa destino (default 60 = faturar)
// bloqueia tipo_nota='D1' (venda interna sem NF)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { carga_id, etapa_destino = '60' } = body;
    if (!carga_id) return Response.json({ error: 'carga_id obrigatório' }, { status: 400 });

    const carga = await base44.asServiceRole.entities.Carga.get(carga_id);
    if (!carga) return Response.json({ error: 'Carga não encontrada' }, { status: 404 });

    const pedidos = carga.pedidos_omie || [];
    const resultados = [];

    for (const p of pedidos) {
      // Pula pedidos D1 (cliente não emite NF)
      if (p.tipo_nota === 'D1') {
        resultados.push({ codigo_pedido: p.codigo_pedido, skip: true, motivo: 'cliente D1 - não emite NF' });
        continue;
      }

      try {
        const data = await omieCall('AlterarPedidoVenda', {
          cabecalho: {
            codigo_pedido: Number(p.codigo_pedido),
            etapa: String(etapa_destino)
          }
        });
        const ok = data.cCodStatus === '0' || data.cCodStatus === 0;
        resultados.push({
          codigo_pedido: p.codigo_pedido,
          sucesso: ok,
          mensagem: data.cDescStatus || ''
        });
      } catch (err) {
        resultados.push({
          codigo_pedido: p.codigo_pedido,
          sucesso: false,
          mensagem: err.message
        });
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => r.sucesso === false).length;
    const skips = resultados.filter(r => r.skip).length;

    await base44.asServiceRole.entities.Carga.update(carga_id, {
      status_carga: erros > 0 ? 'conferindo' : 'faturada',
      data_faturamento: new Date().toISOString()
    });

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'AlterarPedidoVenda',
      operacao: 'faturar_carga',
      entidade_tipo: 'Carga',
      entidade_id: carga_id,
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} pedidos falharam` : null,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      total: pedidos.length,
      sucessos,
      erros,
      skips,
      resultados
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});