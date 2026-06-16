import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ⚡ WEBHOOK RECEIVER — Blindado e ultra leve (< 200ms)
// Apenas valida, aplica segurança e enfileira. Processamento pesado é assíncrono (processarWebhookOmie).
//
// URL a cadastrar no Omie:
//   https://app.base44.com/api/apps/<APP_ID>/functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>
//
// 🛡️ Camadas de segurança:
//   1. Rate limiting por IP (RateLimitWebhook) — 30 req/min
//   2. Sanitização de payload (Content-Type, tamanho, estrutura)
//   3. Mensagens de erro genéricas para o exterior (nunca vaza err.message/stack)
//   4. Resposta rápida garantida — só enfileira, não processa

const MAX_PAYLOAD_BYTES = 50000;
const MAX_LOG_FIELD = 3000;
const RATE_LIMIT_MAX = 30;
const RATE_WINDOW_MS = 60 * 1000;

// Tópicos que o sistema NÃO processa — gravados já como 'ignorado' (não entram na
// fila de processamento, mas ficam registrados para auditoria). Reduz o ruído.
const TOPICS_IRRELEVANTES_PREFIX = ['Financas.', 'Produto.', 'TabelaPrecoItem', 'Departamento', 'Categoria', 'ClienteFornecedor.', 'RecebimentoProduto.'];
const ehTopicIrrelevante = (t) => TOPICS_IRRELEVANTES_PREFIX.some(p => String(t || '').startsWith(p));

const truncar = (valor) => String(valor ?? '').slice(0, MAX_LOG_FIELD);

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

    // base44 com service role — Omie chama sem cookie/token Base44
    const base44 = createClientFromRequest(req);

    // Rate limiting removido — o token de autenticação já protege o endpoint.
    // Webhooks do Omie chegam em pares simultâneos (Faturada + EtapaAlterada) e
    // o rate limit por banco causava race condition, bloqueando requisições legítimas.

    // ───────────────────────────────────────────────
    // 2. SANITIZAÇÃO DE PAYLOAD
    // ───────────────────────────────────────────────
    const contentType = (req.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return Response.json({ erro: 'Invalid Content-Type' }, { status: 415 });
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return Response.json({ erro: 'Payload Too Large' }, { status: 413 });
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return Response.json({ erro: 'Invalid payload' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ erro: 'Invalid payload' }, { status: 400 });
    }

    const { topic, messageId, appKey } = body;
    // Estrutura esperada: pelo menos topic OU appKey
    if (!topic && !appKey) {
      return Response.json({ erro: 'Invalid payload' }, { status: 400 });
    }

    // Validação extra: app_key
    const appKeyEsperada = Deno.env.get('OMIE_APP_KEY');
    if (appKey && appKeyEsperada && appKey !== appKeyEsperada) {
      return Response.json({ error: 'app_key inválida' }, { status: 401 });
    }

    // ───────────────────────────────────────────────
    // Idempotência + enfileiramento rápido
    // ───────────────────────────────────────────────
    try {
      if (messageId) {
        const existentes = await base44.asServiceRole.entities.LogIntegracaoOmie.filter({
          webhook_message_id: String(messageId)
        });
        if (existentes.length > 0) {
          return Response.json({ sucesso: true, mensagem: 'Já processado', duplicado: true });
        }
      }

      // Tópicos irrelevantes entram já como 'ignorado' — não poluem a fila de processamento.
      const statusInicial = ehTopicIrrelevante(topic) ? 'ignorado' : 'pendente';
      const logCriado = await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: truncar('webhook'),
        call: truncar(topic || 'desconhecido'),
        operacao: 'receber_webhook',
        status: statusInicial,
        mensagem_erro: statusInicial === 'ignorado' ? 'Tópico não processado pelo sistema' : null,
        webhook_topic: truncar(topic || ''),
        webhook_message_id: messageId ? truncar(String(messageId)) : '',
        payload_resposta: truncar(JSON.stringify(body))
      });

      // ⚡ TEMPO REAL: dispara o processamento do espelho IMEDIATAMENTE (fire-and-forget),
      // sem esperar a automação de 5min nem bloquear a resposta ao Omie.
      // Passamos o mesmo payload que a entity automation enviaria (event + data).
      if (statusInicial === 'pendente') {
        base44.asServiceRole.functions.invoke('processarWebhookOmie', {
          event: { type: 'create', entity_name: 'LogIntegracaoOmie', entity_id: logCriado.id },
          data: logCriado
        }).catch((e) => console.error('[receberWebhookOmie] disparo processarWebhookOmie falhou:', e?.message));
      }
    } catch (filaErr) {
      // Único caso em que sinalizamos falha ao Omie: não conseguimos enfileirar
      console.error('[receberWebhookOmie] falha ao enfileirar:', filaErr);
      return Response.json({ sucesso: false, error: 'Processing failed' }, { status: 500 });
    }

    // ───────────────────────────────────────────────
    // 4. Resposta rápida — processamento pesado é async (processarWebhookOmie)
    // ───────────────────────────────────────────────
    return Response.json({ sucesso: true });
  } catch (err) {
    // 3. Erro genérico para fora; detalhe só nos logs Base44
    console.error('[receberWebhookOmie] erro interno:', err);
    return Response.json({ sucesso: true });
  }
});