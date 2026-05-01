import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Endpoints Omie:
// - /produtos/pedido/ → ConsultarPedido (consulta dados do pedido)
// - /produtos/pedidovendafat/ → CancelarPedidoVenda (cancela NF faturada)
const OMIE_URL_PEDIDO = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_URL_FAT = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

async function omieCall(url, call, param, tentativa = 1) {
  const res = await fetch(url, {
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
      return omieCall(url, call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Cancela NF/Pedido no Omie e registra Cancelamento local
// body: { codigo_pedido, motivo, origem = 'manual' }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, motivo = '', origem = 'manual' } = body;
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });

    let status = 'cancelado';
    let erroOmie = null;
    let numeroNf = '';
    let valorNf = 0;
    let clienteNome = '';

    try {
      const consulta = await omieCall(OMIE_URL_PEDIDO, 'ConsultarPedido', { codigo_pedido: Number(codigo_pedido) });
      const pedido = consulta.pedido_venda_produto;
      numeroNf = pedido?.informacoes_adicionais?.numero_nfe || '';
      valorNf = pedido?.total_pedido?.valor_total_pedido || 0;
      clienteNome = pedido?.cabecalho?.codigo_cliente || '';
    } catch (_) { /* ignore */ }

    // CancelarPedidoVenda fica em /produtos/pedidovendafat/ (endpoint de faturamento)
    try {
      await omieCall(OMIE_URL_FAT, 'CancelarPedidoVenda', {
        nCodPed: Number(codigo_pedido),
        cJustCanc: motivo || `Cancelamento via ${origem}`
      });
    } catch (err) {
      const msg = err.message.toLowerCase();
      if (msg.includes('já') || msg.includes('ja cancelado') || msg.includes('cancelado')) {
        status = 'ja_cancelado';
      } else {
        status = 'erro';
        erroOmie = err.message;
      }
    }

    const registro = await base44.asServiceRole.entities.Cancelamento.create({
      pedido_codigo_omie: String(codigo_pedido),
      numero_nf: String(numeroNf),
      valor_nf: Number(valorNf) || 0,
      cliente_nome: String(clienteNome),
      data_cancelamento: new Date().toISOString(),
      motivo,
      origem,
      funcionario_nome: user.full_name || user.email,
      status,
      erro_omie: erroOmie
    });

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedidovendafat',
      call: 'CancelarPedidoVenda',
      operacao: `cancelar_${origem}`,
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: status === 'erro' ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({ sucesso: status !== 'erro', status, registro_id: registro.id, erro: erroOmie });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});