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

// Corta itens de um pedido Omie:
// - cortes = [{ codigo_produto, nova_quantidade, motivo }]
// Para cada item: consulta pedido, altera qtd (ou remove se 0), registra LogCorte, sincroniza
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, cortes = [], motivo_geral = '' } = body;
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });
    if (cortes.length === 0) return Response.json({ error: 'cortes vazio' }, { status: 400 });

    // 1. Consulta pedido atual
    const consulta = await omieCall('ConsultarPedido', { codigo_pedido: Number(codigo_pedido) });
    const pedido = consulta.pedido_venda_produto;
    if (!pedido) return Response.json({ error: 'Pedido não encontrado no Omie' }, { status: 404 });
    if (JSON.stringify(pedido).toLowerCase().includes('cancelado') || JSON.stringify(pedido).toLowerCase().includes('cancelada')) {
      return Response.json({ error: 'Pedido cancelado: não é permitido editar ou ajustar.' }, { status: 400 });
    }

    const itensAtuais = pedido.det || [];
    const logs = [];

    // 2. Monta nova lista de itens com cortes aplicados
    const novosItens = [];
    for (const item of itensAtuais) {
      const codProdInt = item.produto?.codigo_produto_integracao;
      const codProd = item.produto?.codigo_produto;
      const corte = cortes.find(c =>
        String(c.codigo_produto) === String(codProd) ||
        String(c.codigo_produto) === String(codProdInt)
      );

      if (!corte) {
        novosItens.push(item);
        continue;
      }

      const qtdAnterior = item.produto?.quantidade || 0;
      const qtdNova = Number(corte.nova_quantidade);
      const valorUnit = item.produto?.valor_unitario || 0;

      logs.push({
        pedido_codigo_omie: String(codigo_pedido),
        numero_pedido: String(pedido.cabecalho?.numero_pedido || ''),
        produto_codigo: String(codProd || ''),
        produto_codigo_integracao: String(codProdInt || ''),
        produto_descricao: item.produto?.descricao || '',
        quantidade_anterior: qtdAnterior,
        quantidade_nova: qtdNova,
        quantidade_cortada: qtdAnterior - qtdNova,
        valor_unitario: valorUnit,
        valor_anterior: qtdAnterior * valorUnit,
        valor_novo: qtdNova * valorUnit,
        valor_cortado: (qtdAnterior - qtdNova) * valorUnit,
        motivo: corte.motivo || motivo_geral,
        tipo_operacao: qtdNova === 0 ? 'remocao_item' : 'corte_quantidade',
        funcionario_nome: user.full_name || user.email,
        sincronizado_omie: false
      });

      if (qtdNova > 0) {
        novosItens.push({
          ...item,
          produto: { ...item.produto, quantidade: qtdNova }
        });
      }
    }

    // 3. Envia alteração ao Omie
    let erroOmie = null;
    try {
      await omieCall('AlterarPedidoVenda', {
        cabecalho: {
          codigo_pedido: Number(codigo_pedido),
          etapa: pedido.cabecalho?.etapa || '10'
        },
        det: novosItens
      });
    } catch (err) {
      erroOmie = err.message;
    }

    // 4. Registra logs de corte
    for (const log of logs) {
      await base44.asServiceRole.entities.LogCorte.create({
        ...log,
        sincronizado_omie: !erroOmie,
        erro_omie: erroOmie
      }).catch(() => {});
    }

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'AlterarPedidoVenda',
      operacao: 'cortar_pedido',
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: erroOmie ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    if (erroOmie) return Response.json({ error: erroOmie }, { status: 500 });
    return Response.json({ sucesso: true, itens_alterados: logs.length, logs });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});