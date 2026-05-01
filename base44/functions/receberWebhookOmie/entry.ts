import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Webhook público recebido do Omie. Configurar no painel do Omie:
// URL: https://<seu-app>.base44.app/functions/receberWebhookOmie?token=XXXXX
// Eventos: VendaProduto.StatusAlterado, VendaProduto.Faturado, VendaProduto.Cancelado, Cliente.Excluido
//
// Validação: o webhook só é aceito se o token na query string bater com OMIE_WEBHOOK_TOKEN
// (defina esse secret no painel do Base44 antes de configurar o webhook no Omie).

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const tokenRecebido = url.searchParams.get('token');
    const tokenEsperado = Deno.env.get('OMIE_WEBHOOK_TOKEN');

    // Validação obrigatória de token
    if (!tokenEsperado) {
      console.error('[receberWebhookOmie] OMIE_WEBHOOK_TOKEN não configurado');
      return Response.json({ error: 'Webhook não configurado' }, { status: 500 });
    }
    if (tokenRecebido !== tokenEsperado) {
      console.warn('[receberWebhookOmie] Token inválido');
      return Response.json({ error: 'Token inválido' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { topic, event, appKey, messageId } = body;
    const evt = event || body;

    console.log('[receberWebhookOmie] Topic:', topic, 'MessageId:', messageId);

    // Validação extra: app_key do payload bate com a configurada
    const appKeyEsperada = Deno.env.get('OMIE_APP_KEY');
    if (appKey && appKeyEsperada && appKey !== appKeyEsperada) {
      console.warn('[receberWebhookOmie] app_key não confere');
      return Response.json({ error: 'app_key inválida' }, { status: 401 });
    }

    // Cria cliente para acesso ao banco (via service role, pois webhook não tem usuário)
    const base44 = createClientFromRequest(req);

    // Registrar log da chamada
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'webhook',
      call: topic || 'desconhecido',
      operacao: 'receber_webhook',
      status: 'sucesso',
      payload_resposta: JSON.stringify(body).slice(0, 5000)
    }).catch(() => {});

    // Roteamento por tópico
    if (topic?.startsWith('VendaProduto.')) {
      // Atualizar status do pedido local
      const codigoPedido = String(evt?.idPedido || evt?.codigo_pedido || '');
      if (codigoPedido) {
        const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
        if (pedidos.length > 0) {
          const updates = {};
          if (topic === 'VendaProduto.Faturado') {
            updates.status = 'faturado';
            updates.faturado = true;
            updates.data_faturamento = new Date().toISOString();
            if (evt?.numero_nf) updates.numero_nota_fiscal = String(evt.numero_nf);
          } else if (topic === 'VendaProduto.Cancelado') {
            updates.status = 'cancelado';
          } else if (topic === 'VendaProduto.StatusAlterado') {
            // Mapear etapas para status local
            const etapa = String(evt?.etapa || '');
            if (etapa === '20') updates.status = 'liberado';
            else if (etapa === '50') updates.status = 'faturado';
            else if (etapa === '70') updates.status = 'cancelado';
          }
          if (Object.keys(updates).length > 0) {
            await base44.asServiceRole.entities.Pedido.update(pedidos[0].id, updates);
            console.log('[receberWebhookOmie] Pedido atualizado:', pedidos[0].id, updates);
          }
        }
      }
    }

    if (topic === 'Cliente.Excluido') {
      const codigoOmie = String(evt?.codigo_cliente_omie || '');
      if (codigoOmie) {
        const clientes = await base44.asServiceRole.entities.Cliente.filter({ codigo_omie: codigoOmie });
        for (const c of clientes) {
          await base44.asServiceRole.entities.Cliente.update(c.id, { codigo_omie: null });
          console.log('[receberWebhookOmie] codigo_omie limpo do cliente:', c.id);
        }
      }
    }

    return Response.json({ sucesso: true, mensagem: 'Webhook processado' });
  } catch (error) {
    console.error('[receberWebhookOmie] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});