import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 🧹 LIMPEZA DO BACKLOG DE WEBHOOKS PENDENTES
// ─────────────────────────────────────────────────────────────────────────────
// Arquiva (status=ignorado) webhooks pendentes que NÃO devem ser reprocessados:
//   1. Antigos: pendentes há mais de HORAS_CORTE (default 8h) — o pedido já mudou
//      de estado várias vezes desde então; reprocessar é inútil e arriscado.
//   2. Redundantes: para tópicos de estado (EtapaAlterada/Alterada/Faturada),
//      mantém apenas o evento MAIS RECENTE por pedido (idPedido/codIntPedido) e
//      arquiva os mais antigos.
//   3. Irrelevantes: tópicos que o sistema não processa são arquivados direto.
//
// NÃO chama a Omie. Apenas atualiza status no banco, em LOTES PARALELOS limitados
// (evita estourar o rate limit do SDK Base44). Re-executável até zerar o backlog:
// retorna restantes_pendentes — chame de novo enquanto > 0.
// Padrões: base44 1º arg, SDK 0.8.31, filter por chave.

const HORAS_CORTE_PADRAO = 8;
const MAX_VARRER = 1500;       // quantos pendentes carregar por execução
const MAX_ARQUIVAR = 250;      // quantos arquivar por execução (limita updates → evita 429)
const DELAY_ENTRE_UPDATES_MS = 120; // updates SERIAIS — o SDK estoura com concorrência

const TOPICS_IRRELEVANTES_PREFIX = ['Financas.', 'Produto.', 'TabelaPrecoItem', 'Departamento', 'Categoria', 'ClienteFornecedor.', 'RecebimentoProduto.'];
const TOPICS_ESTADO = new Set(['VendaProduto.EtapaAlterada', 'VendaProduto.Alterada', 'VendaProduto.Faturada']);

const topicDoLog = (log) => log.webhook_topic || log.call || '';
const ehIrrelevante = (topic) => TOPICS_IRRELEVANTES_PREFIX.some(p => topic.startsWith(p));

function idPedidoDoLog(log) {
  let body;
  try { body = JSON.parse(log.payload_resposta || '{}'); } catch { body = {}; }
  const evt = body.event || body;
  return String(evt?.idPedido || evt?.codIntPedido || evt?.id_pedido || evt?.nCodPed || '');
}

// Arquiva uma lista de {id, motivo} de forma SERIAL (1 por vez) com micro-delay.
// O SDK Base44 estoura o rate limit com updates concorrentes, então serializamos.
async function arquivarSerial(base44, alvos) {
  let ok = 0;
  for (const a of alvos) {
    try {
      await base44.asServiceRole.entities.LogIntegracaoOmie.update(a.id, {
        status: 'ignorado', mensagem_erro: a.motivo, webhook_processado_em: new Date().toISOString()
      });
      ok++;
    } catch { /* segue */ }
    await new Promise(r => setTimeout(r, DELAY_ENTRE_UPDATES_MS));
  }
  return ok;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const payload = await req.json().catch(() => ({}));
    const horasCorte = Number(payload?.horas_corte ?? HORAS_CORTE_PADRAO);
    const cutoffMs = Date.now() - horasCorte * 60 * 60 * 1000;

    const pendentes = await base44.asServiceRole.entities.LogIntegracaoOmie.filter(
      { endpoint: 'webhook', status: 'pendente' }, 'created_date', MAX_VARRER
    ).catch(() => []);

    // Classifica TODO o conjunto carregado (em memória, sem chamadas).
    const maisRecentePorPedido = new Map(); // idPedido -> id do log mais recente (estado)
    const estadoPorPedido = new Map();       // idPedido -> [ids de logs de estado]
    const alvos = []; // { id, motivo }

    for (const log of pendentes) {
      const topic = topicDoLog(log);

      if (ehIrrelevante(topic)) {
        alvos.push({ id: log.id, motivo: 'Tópico não processado (backlog cleanup)' });
        continue;
      }
      if (new Date(log.created_date).getTime() < cutoffMs) {
        alvos.push({ id: log.id, motivo: `Evento antigo (>${horasCorte}h) — descartado no cleanup` });
        continue;
      }
      if (TOPICS_ESTADO.has(topic)) {
        const idPedido = idPedidoDoLog(log);
        if (idPedido) {
          if (!estadoPorPedido.has(idPedido)) estadoPorPedido.set(idPedido, []);
          estadoPorPedido.get(idPedido).push(log.id);
          maisRecentePorPedido.set(idPedido, log.id); // asc → último = mais recente
        }
      }
    }

    // Redundantes de estado: todos menos o mais recente de cada pedido.
    for (const [idPedido, ids] of estadoPorPedido.entries()) {
      const manter = maisRecentePorPedido.get(idPedido);
      for (const id of ids) {
        if (id !== manter) alvos.push({ id, motivo: 'Evento de estado redundante — substituído por evento mais recente do mesmo pedido' });
      }
    }

    // Limita a quantidade arquivada por execução (evita 429/timeout). O resto fica para a próxima.
    const totalAlvos = alvos.length;
    const lote = alvos.slice(0, MAX_ARQUIVAR);
    const arquivados = await arquivarSerial(base44, lote);

    return Response.json({
      sucesso: true,
      varridos: pendentes.length,
      horas_corte: horasCorte,
      arquivados_nesta_execucao: arquivados,
      total_a_arquivar_identificados: totalAlvos,
      restantes_a_arquivar: Math.max(0, totalAlvos - arquivados),
      precisa_rodar_novamente: totalAlvos > arquivados || pendentes.length === MAX_VARRER
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});