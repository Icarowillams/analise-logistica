import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ════════════════════════════════════════════════════════════════════════
// AUDITORIA: itens digitados no pedido (Base44) × itens registrados no Omie
//
// Rede de segurança contra o bug do pedido 1760 (Artesanal digitado, 450G
// faturado). Compara, item a item, o codigo_omie do produto local com o
// codigo_produto que o Omie gravou no pedido. Se divergir → DIVERGÊNCIA.
//
// Recebe { pedido_id } OU { omie_codigo_pedido }.
// Não altera nada no Omie — apenas consulta e devolve o laudo.
// ════════════════════════════════════════════════════════════════════════

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

async function getOmieCredentials(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = Deno.env.get('OMIE_APP_KEY') || cfg?.app_key || '';
  const appSecret = Deno.env.get('OMIE_APP_SECRET') || cfg?.app_secret || '';
  return { appKey, appSecret };
}

async function omieConsultarPedido(base44, codigoPedido) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  const res = await fetch(OMIE_BASE_URL + 'produtos/pedido/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call: 'ConsultarPedido', app_key: appKey, app_secret: appSecret, param: [{ codigo_pedido: Number(codigoPedido) }] })
  });
  const data = await res.json().catch(() => ({}));
  if (data?.faultstring) throw new Error(data.faultstring);
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    let { pedido_id, omie_codigo_pedido } = body;

    // Resolver pedido local
    let pedido = null;
    if (pedido_id) {
      pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id).catch(() => null);
    } else if (omie_codigo_pedido) {
      const rows = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(omie_codigo_pedido) }, '-created_date', 1).catch(() => []);
      pedido = rows?.[0] || null;
    }
    if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
    if (!pedido.omie_codigo_pedido) return Response.json({ error: 'Pedido ainda não enviado ao Omie' }, { status: 400 });

    // Itens locais + produtos
    const items = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: pedido.id });
    const produtoIds = [...new Set(items.map(i => i.produto_id))];
    const produtos = await Promise.all(produtoIds.map(pid => base44.asServiceRole.entities.Produto.get(pid).catch(() => null)));
    const prodMap = {};
    produtos.forEach(p => { if (p) prodMap[p.id] = p; });

    // Pedido no Omie
    const omie = await omieConsultarPedido(base44, pedido.omie_codigo_pedido);
    const detOmie = omie?.pedido_venda_produto?.det || omie?.pedido?.det || [];

    // Indexar itens Omie por codigo_item_integracao (= id do PedidoItem) e por codigo_produto
    const omiePorIntegracao = {};
    const omieProdutos = [];
    detOmie.forEach(d => {
      const intId = d?.ide?.codigo_item_integracao;
      const codProd = d?.produto?.codigo_produto;
      const desc = d?.produto?.descricao;
      const qtd = d?.produto?.quantidade;
      if (intId) omiePorIntegracao[String(intId)] = { codProd, desc, qtd };
      omieProdutos.push({ codProd: String(codProd), desc, qtd, intId });
    });

    const divergencias = [];
    const conferidos = [];

    for (const item of items) {
      const prod = prodMap[item.produto_id] || {};
      const codLocal = prod.codigo_omie ? String(prod.codigo_omie) : null;
      const omieItem = omiePorIntegracao[String(item.id)] || null;
      const codOmie = omieItem ? String(omieItem.codProd) : null;

      const registro = {
        produto_codigo: item.produto_codigo,
        produto_nome: item.produto_nome || prod.nome,
        produto_id: item.produto_id,
        codigo_omie_local: codLocal,
        codigo_omie_faturado: codOmie,
        descricao_faturada_omie: omieItem?.desc || null,
        quantidade_pedido: item.quantidade,
        quantidade_omie: omieItem?.qtd ?? null,
      };

      // Divergência de produto: o que o Omie faturou ≠ o que estava no produto local
      if (codLocal && codOmie && codLocal !== codOmie) {
        registro.tipo = 'PRODUTO_DIFERENTE';
        divergencias.push(registro);
      } else if (!codLocal) {
        registro.tipo = 'PRODUTO_SEM_CODIGO_OMIE_LOCAL';
        divergencias.push(registro);
      } else {
        conferidos.push(registro);
      }
    }

    const ok = divergencias.length === 0;

    return Response.json({
      sucesso: true,
      pedido_id: pedido.id,
      numero_pedido: pedido.numero_pedido,
      omie_codigo_pedido: pedido.omie_codigo_pedido,
      cliente_nome: pedido.cliente_nome,
      conferido: ok,
      total_itens: items.length,
      divergencias,
      conferidos,
    });
  } catch (error) {
    const bloqueada = /bloquead|425|consumo indevido/i.test(error.message || '');
    return Response.json({ sucesso: false, erro: error.message, omie_bloqueada: bloqueada }, { status: bloqueada ? 425 : 500 });
  }
});