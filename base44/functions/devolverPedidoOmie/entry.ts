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

// Devolve itens de um pedido Omie (parcial ou total)
// body: { codigo_pedido, produtos: [{nCodProd, quantidade, motivo}], tipo_retorno, motivo_geral }
// IMPORTANTE: usa nCodProd (código interno do Omie), NÃO codigo_produto_integracao
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, produtos = [], tipo_retorno = 'devolucao_parcial', motivo_geral = '', carga_id = null } = body;
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });
    if (produtos.length === 0) return Response.json({ error: 'produtos vazio' }, { status: 400 });

    const consulta = await omieCall('ConsultarPedido', { codigo_pedido: Number(codigo_pedido) });
    if (JSON.stringify(consulta?.pedido_venda_produto || {}).toLowerCase().includes('cancelado') || JSON.stringify(consulta?.pedido_venda_produto || {}).toLowerCase().includes('cancelada')) {
      return Response.json({ error: 'Pedido cancelado: não é permitido editar ou ajustar.' }, { status: 400 });
    }

    const produtosDevolver = produtos.map(p => ({
      nCodProd: Number(p.nCodProd || p.codigo_produto),
      nQtde: Number(p.quantidade)
    }));

    let erroOmie = null;
    let nIdDevolucao = null;
    try {
      const resp = await omieCall('DevolverPedido', {
        nCodPed: Number(codigo_pedido),
        produtos: produtosDevolver
      });
      // Captura nIdDevolucao retornado pelo Omie para rastreio
      nIdDevolucao = resp?.nIdDevolucao || resp?.nCodDevolucao || null;
    } catch (err) {
      erroOmie = err.message;
    }

    // Calcula valor total da devolução
    const valorTotal = produtos.reduce((s, p) => s + (Number(p.valor_unitario || 0) * Number(p.quantidade || 0)), 0);

    const registro = await base44.asServiceRole.entities.Retorno.create({
      pedido_codigo_omie: String(codigo_pedido),
      carga_id,
      data_retorno: new Date().toISOString().slice(0, 10),
      produtos: produtos.map(p => ({
        codigo_produto: String(p.nCodProd || p.codigo_produto),
        descricao: p.descricao || '',
        quantidade: Number(p.quantidade),
        valor_unitario: Number(p.valor_unitario || 0),
        valor_total: Number(p.valor_unitario || 0) * Number(p.quantidade),
        motivo: p.motivo || motivo_geral
      })),
      tipo_retorno,
      valor_total_retorno: valorTotal,
      motivo_geral,
      status: erroOmie ? 'pendente' : 'devolvido_omie',
      observacoes: nIdDevolucao ? `nIdDevolucao Omie: ${nIdDevolucao}` : null
    });

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'DevolverPedido',
      operacao: 'devolver_pedido',
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: erroOmie ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    if (erroOmie) return Response.json({ error: erroOmie, registro_id: registro.id }, { status: 500 });
    return Response.json({ sucesso: true, registro_id: registro.id, valor_total: valorTotal, nIdDevolucao });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});