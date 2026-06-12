import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 🧹 LIMPEZA DOS WEBHOOKS NFe TRAVADOS NO LOOP 105 + 6
// ─────────────────────────────────────────────────────────────────────────────
// Marca como "ignorado" os webhooks NFe.NotaAutorizada / NFe.NotaDevolucaoAutorizada
// que estão em erro com "consumo redundante" (causados pelo antigo ConsultarPedido
// com id_pedido inexistente — faultcode 105). Esses webhooks não têm pedido local
// correspondente (são NFs externas/de outra origem) e nunca vão resolver no retry.
//
// Padrões: base44 1º arg, SDK 0.8.31, filter por chave, admin-only.

const TOPICS = ['NFe.NotaAutorizada', 'NFe.NotaDevolucaoAutorizada'];
const LOTE = 50;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let limpos = 0;
    const detalhes = [];

    for (const topic of TOPICS) {
      // Busca em erro por tópico (filter por chave). Pega tudo (até 200) e filtra o motivo no JS.
      const emErro = await base44.asServiceRole.entities.LogIntegracaoOmie.filter(
        { endpoint: 'webhook', webhook_topic: topic, status: 'erro' }, '-created_date', 200
      ).catch(() => []);

      const travados = emErro.filter(l => {
        const m = String(l.mensagem_erro || '').toLowerCase();
        return m.includes('redundante') || m.includes('consumo') || m.includes('aguarde') || m.includes('105') || m.includes('não cadastrado') || m.includes('nao cadastrado');
      }).slice(0, LOTE);

      for (const log of travados) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.update(log.id, {
          status: 'ignorado',
          mensagem_erro: 'NF sem pedido local — webhook ignorado (sem ConsultarPedido)',
          webhook_processado_em: new Date().toISOString()
        }).catch(() => {});
        limpos++;
      }
      detalhes.push({ topic, encontrados: travados.length });
    }

    return Response.json({ sucesso: true, limpos, detalhes });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});