import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Webhook público recebido do Omie.
// URL a cadastrar no painel Omie:
//   https://app.base44.com/api/apps/<APP_ID>/functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>
//
// Eventos suportados (assinar no painel do Omie):
//   - VendaProduto.Faturada / VendaProduto.Cancelada / VendaProduto.EtapaAlterada / VendaProduto.Alterada / VendaProduto.Excluida
//   - NFe.NotaAutorizada / NFe.NotaCancelada
//   - ClienteFornecedor.Alterado / ClienteFornecedor.Excluido / ClienteFornecedor.Incluido
//   - Produto.Alterado / Produto.Excluido / Produto.Incluido
//   - Financas.ContaReceber.BoletoGerado / Financas.ContaReceber.BaixaRealizada

// === helpers ===
async function logWebhook(base44, topic, body, status = 'sucesso', erro = null) {
  await base44.asServiceRole.entities.LogIntegracaoOmie.create({
    endpoint: 'webhook',
    call: topic || 'desconhecido',
    operacao: 'receber_webhook',
    status,
    mensagem_erro: erro,
    payload_resposta: JSON.stringify(body).slice(0, 5000)
  }).catch(() => {});
}

// Mapeia etapa Omie → status local do pedido
function mapEtapaParaStatus(etapa) {
  const e = String(etapa || '');
  if (e === '10') return 'pendente';
  if (e === '20') return 'liberado';
  if (e === '50') return 'montagem';
  if (e === '60') return 'faturado';
  if (e === '70' || e === '80') return 'cancelado';
  return null;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const tokenRecebido = url.searchParams.get('token');
    const tokenEsperado = Deno.env.get('OMIE_WEBHOOK_TOKEN');

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
    const appKeyEsperada = Deno.env.get('OMIE_APP_KEY') || Deno.env.get('OMIE_API_KEY');
    if (appKey && appKeyEsperada && appKey !== appKeyEsperada) {
      console.warn('[receberWebhookOmie] app_key não confere');
      return Response.json({ error: 'app_key inválida' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    await logWebhook(base44, topic, body);

    // ========== VENDAS / PEDIDOS ==========
    if (topic?.startsWith('VendaProduto.')) {
      const codigoPedido = String(evt?.idPedido || evt?.codigo_pedido || '');
      if (codigoPedido) {
        const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
        if (pedidos.length > 0) {
          const updates = {};
          if (topic === 'VendaProduto.Faturada') {
            updates.status = 'faturado';
            updates.faturado = true;
            updates.data_faturamento = new Date().toISOString();
            if (evt?.numero_nf) updates.numero_nota_fiscal = String(evt.numero_nf);
          } else if (topic === 'VendaProduto.Cancelada' || topic === 'VendaProduto.Excluida') {
            updates.status = 'cancelado';
            updates.data_cancelamento = new Date().toISOString();
            updates.motivo_cancelamento = `Cancelado/excluído no Omie (${topic})`;
          } else if (topic === 'VendaProduto.EtapaAlterada') {
            const novoStatus = mapEtapaParaStatus(evt?.etapa);
            if (novoStatus) updates.status = novoStatus;
          }
          if (Object.keys(updates).length > 0) {
            await base44.asServiceRole.entities.Pedido.update(pedidos[0].id, updates);
            console.log('[receberWebhookOmie] Pedido atualizado:', pedidos[0].id, updates);
          }
        }
      }
    }

    // ========== NFe ==========
    if (topic === 'NFe.NotaAutorizada' || topic === 'NFe.NotaCancelada') {
      const codigoPedido = String(evt?.idPedido || evt?.codigo_pedido || '');
      if (codigoPedido) {
        const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
        if (pedidos.length > 0) {
          const updates = {};
          if (topic === 'NFe.NotaAutorizada') {
            updates.faturado = true;
            updates.status = 'faturado';
            updates.data_faturamento = new Date().toISOString();
            if (evt?.numero_nf || evt?.numero_nota) updates.numero_nota_fiscal = String(evt.numero_nf || evt.numero_nota);
          } else if (topic === 'NFe.NotaCancelada') {
            updates.status = 'cancelado';
            updates.data_cancelamento = new Date().toISOString();
            updates.motivo_cancelamento = 'NF-e cancelada no Omie';
          }
          await base44.asServiceRole.entities.Pedido.update(pedidos[0].id, updates);
        }
      }
    }

    // ========== CLIENTES ==========
    if (topic?.startsWith('ClienteFornecedor.')) {
      const codigoOmie = String(evt?.codigo_cliente_omie || evt?.idCliente || '');
      const codigoIntegracao = String(evt?.codigo_cliente_integracao || '');

      if (topic === 'ClienteFornecedor.Excluido' && codigoOmie) {
        const clientes = await base44.asServiceRole.entities.Cliente.filter({ codigo_omie: codigoOmie });
        for (const c of clientes) {
          await base44.asServiceRole.entities.Cliente.update(c.id, { codigo_omie: null, status: 'inativo' });
          console.log('[receberWebhookOmie] Cliente marcado inativo (excluído no Omie):', c.id);
        }
      }

      // Para Alterado/Incluido: re-sincroniza dados do Omie pro Base44 (chama consultarClientesOmie best-effort)
      if ((topic === 'ClienteFornecedor.Alterado' || topic === 'ClienteFornecedor.Incluido') && (codigoOmie || codigoIntegracao)) {
        // Best-effort: marca pra auditoria. Sincronização completa via job dedicado pra evitar loop.
        console.log('[receberWebhookOmie] Cliente alterado/incluído no Omie — registrado para auditoria:', codigoOmie || codigoIntegracao);
      }
    }

    // ========== PRODUTOS ==========
    if (topic?.startsWith('Produto.')) {
      const codigoOmie = String(evt?.codigo_produto || evt?.idProduto || '');
      const codigoIntegracao = String(evt?.codigo_produto_integracao || '');

      if (topic === 'Produto.Excluido' && codigoOmie) {
        const produtos = await base44.asServiceRole.entities.Produto.filter({ codigo_omie: codigoOmie });
        for (const p of produtos) {
          await base44.asServiceRole.entities.Produto.update(p.id, { codigo_omie: null, status: 'inativo' });
          console.log('[receberWebhookOmie] Produto marcado inativo (excluído no Omie):', p.id);
        }
      }

      if ((topic === 'Produto.Alterado' || topic === 'Produto.Incluido') && (codigoOmie || codigoIntegracao)) {
        console.log('[receberWebhookOmie] Produto alterado/incluído no Omie — registrado para auditoria:', codigoOmie || codigoIntegracao);
      }
    }

    // ========== FINANÇAS / BOLETOS ==========
    if (topic === 'Financas.ContaReceber.BoletoGerado' || topic === 'Financas.ContaReceber.BaixaRealizada') {
      // Log apenas — fluxo de boleto é tratado em painel próprio
      console.log('[receberWebhookOmie] Evento financeiro registrado:', topic, evt?.codigo_lancamento);
    }

    return Response.json({ sucesso: true, mensagem: 'Webhook processado', topic });
  } catch (error) {
    console.error('[receberWebhookOmie] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});