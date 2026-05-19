import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ⚡ WEBHOOK RECEIVER — Ultra leve (< 200ms)
// Apenas valida e enfileira. Processamento é feito async pelo processarWebhookOmie.
//
// URL a cadastrar no Omie:
//   https://app.base44.com/api/apps/<APP_ID>/functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>
//
// 🛡️ NÃO USA createClientFromRequest porque o Omie chama sem cookie/token Base44 → 403.
//    Usamos createClient + asServiceRole direto.

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const tokenRecebido = url.searchParams.get('token');
    const tokenEsperado = Deno.env.get('OMIE_WEBHOOK_TOKEN');

    if (!tokenEsperado) {
      return Response.json({ error: 'Webhook não configurado' }, { status: 500 });
    }
    if (tokenRecebido !== tokenEsperado) {
      return Response.json({ error: 'Token inválido' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { topic, messageId, appKey } = body;

    // Validação extra: app_key
    const appKeyEsperada = Deno.env.get('OMIE_APP_KEY') || Deno.env.get('OMIE_API_KEY');
    if (appKey && appKeyEsperada && appKey !== appKeyEsperada) {
      return Response.json({ error: 'app_key inválida' }, { status: 401 });
    }

    // createClientFromRequest funciona mesmo sem cookie de usuário, contanto que
    // usemos apenas base44.asServiceRole — o SDK injeta o service token do app.
    const base44 = createClientFromRequest(req);

    // Idempotência: se messageId já foi processado, retorna OK sem reprocessar
    if (messageId) {
      const existentes = await base44.asServiceRole.entities.LogIntegracaoOmie.filter({
        webhook_message_id: String(messageId)
      });
      if (existentes.length > 0) {
        return Response.json({ sucesso: true, mensagem: 'Já processado', duplicado: true });
      }
    }

    // Enfileira como pendente — entity automation processarWebhookOmie pega em seguida
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'webhook',
      call: topic || 'desconhecido',
      operacao: 'receber_webhook',
      status: 'pendente',
      webhook_topic: topic || '',
      webhook_message_id: messageId ? String(messageId) : '',
      payload_resposta: JSON.stringify(body).slice(0, 5000)
    });

    return Response.json({ sucesso: true, mensagem: 'Recebido', topic });
  } catch (error) {
    console.error('[receberWebhookOmie] Erro:', error.message);
    // Mesmo com erro interno, retorna 200 — não queremos Omie retentando
    return Response.json({ sucesso: false, error: error.message });
  }
});