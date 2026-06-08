import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

async function getOmieCredentials(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  const appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  return { appKey, appSecret };
}

// Chamada simples ao Omie: sem retry, timeout curto
async function omieCallSimples(base44, endpoint, call, param) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');

  const url = OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10000);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
    signal: controller.signal
  });
  clearTimeout(tid);

  const data = await res.json();
  if (data.faultstring) throw new Error(data.faultstring);
  return data;
}

const ETAPAS_CANCELAVEIS = ['10', '20'];
const ETAPA_NOMES = { '10': 'Pedido de Venda', '20': 'Pedidos Liberados', '50': 'Faturar', '60': 'Faturado' };

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { pedido_id, motivo } = await req.json();
    if (!pedido_id) return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
    if (!motivo || !motivo.trim()) return Response.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 });

    const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
    if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });

    let omieCancelado = false;
    let etapaAtual = null;
    let etapaNome = null;

    if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
      const codigoPedido = Number(pedido.omie_codigo_pedido);

      // Verificar etapa pelo espelho local (evita chamada extra ao Omie)
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
        { codigo_pedido: String(codigoPedido) }, '-created_date', 1
      ).catch(() => []);
      const espelho = espelhos?.[0];

      if (espelho) {
        etapaAtual = espelho.etapa;
        etapaNome = ETAPA_NOMES[etapaAtual] || `Etapa ${etapaAtual}`;

        if (etapaAtual === 'cancelado' || espelho.status_real === 'cancelada') {
          omieCancelado = true;
        } else if (!ETAPAS_CANCELAVEIS.includes(etapaAtual)) {
          return Response.json({
            sucesso: false,
            error: `Não é possível cancelar. Pedido na etapa "${etapaNome}" (${etapaAtual}). Só é possível cancelar nas etapas 10 ou 20.`
          }, { status: 400 });
        }
      }

      // Se não está cancelado, usar ExcluirPedido (método correto para cancelar pedidos nas etapas 10/20)
      if (!omieCancelado) {
        console.log(`[cancelarPedidoOmie] Excluindo pedido ${codigoPedido} no Omie via ExcluirPedido...`);
        await omieCallSimples(base44, 'produtos/pedido/', 'ExcluirPedido', {
          codigo_pedido: codigoPedido
        });
        omieCancelado = true;
        console.log('[cancelarPedidoOmie] Pedido excluído/cancelado com sucesso no Omie.');
      }
    }

    // Buscar nome do funcionário
    let nomeUsuario = user.full_name || user.email;
    const vendedores = await base44.asServiceRole.entities.Vendedor.filter({ email: user.email }).catch(() => []);
    if (vendedores.length > 0) nomeUsuario = vendedores[0].nome;

    // Atualizar pedido local
    await base44.asServiceRole.entities.Pedido.update(pedido_id, {
      status: 'cancelado',
      cancelado_por: user.email,
      cancelado_por_nome: nomeUsuario,
      data_cancelamento: new Date().toISOString(),
      motivo_cancelamento: motivo.trim()
    });

    // Atualizar espelho local
    if (pedido.omie_codigo_pedido) {
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
        { codigo_pedido: String(pedido.omie_codigo_pedido) }, '-created_date', 1
      ).catch(() => []);
      if (espelhos.length > 0) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
          etapa: 'cancelado',
          status_label: 'Cancelado',
          sincronizado_em: new Date().toISOString(),
          origem_sync: 'reconciliacao'
        }).catch(() => null);
      }
    }

    // Log de integração
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'ExcluirPedido',
      operacao: 'cancelar_pedido',
      entidade_tipo: 'Pedido',
      entidade_id: pedido_id,
      status: 'sucesso',
      usuario_email: user.email
    }).catch(() => null);

    return Response.json({
      sucesso: true,
      omie_cancelado: omieCancelado,
      etapa_cancelada: etapaAtual,
      mensagem: omieCancelado
        ? `Pedido cancelado com sucesso (etapa: ${etapaNome || 'N/A'})`
        : 'Pedido cancelado no sistema (não estava no Omie)'
    });

  } catch (error) {
    const msg = error.message || '';
    const msgLower = msg.toLowerCase();

    // Traduzir erros comuns do Omie para mensagens amigáveis
    if (msgLower.includes('redundante') || msgLower.includes('aguarde')) {
      return Response.json({
        sucesso: false,
        error: 'O Omie está em cooldown para este pedido. Aguarde 1 minuto e tente novamente.'
      }, { status: 429 });
    }
    if (msgLower.includes('não encontrado') || msgLower.includes('not found')) {
      return Response.json({
        sucesso: false,
        error: 'Pedido não encontrado no Omie. Pode já ter sido excluído.'
      }, { status: 404 });
    }

    console.error('[cancelarPedidoOmie] Erro:', msg);
    return Response.json({ error: msg, sucesso: false }, { status: 500 });
  }
});