import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════
// RECONCILIAÇÃO PERIÓDICA: Pedidos locais vs Omie
// ═══════════════════════════════════════════════════════════════
// Verifica pedidos com status "faturado" ou "liberado" no local
// que podem ter sido cancelados no Omie sem notificação por webhook.
// Roda a cada 30 min (automação agendada).
// ═══════════════════════════════════════════════════════════════

const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const LOTE = 20; // Pedidos por ciclo
const DELAY_ENTRE_CONSULTAS_MS = 600;

async function resolverCreds(base44) {
  try {
    const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1);
    const cfg = configs?.[0];
    if (cfg?.app_key && cfg?.app_secret) return { app_key: cfg.app_key, app_secret: cfg.app_secret };
  } catch { /* fallback secrets */ }
  return { app_key: Deno.env.get('OMIE_APP_KEY'), app_secret: Deno.env.get('OMIE_APP_SECRET') };
}

async function circuitBreakerBloqueado(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const ctrl = rows?.[0];
  if (ctrl?.bloqueado && ctrl.bloqueado_ate && new Date(ctrl.bloqueado_ate) > new Date()) {
    return true;
  }
  return false;
}

async function consultarPedidoOmie(base44, codigoPedido) {
  const { app_key, app_secret } = await resolverCreds(base44);
  const res = await fetch(OMIE_PEDIDO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarPedido',
      app_key, app_secret,
      param: [{ codigo_pedido: Number(codigoPedido) }]
    })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    // Rate limit / bloqueio → abortar
    if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloquead')) {
      const e = new Error(data.faultstring); e.bloqueio = true; throw e;
    }
    if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante')) {
      const e = new Error(data.faultstring); e.retry = true; throw e;
    }
    throw new Error(data.faultstring);
  }
  return data.pedido_venda_produto || data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Circuit breaker
    if (await circuitBreakerBloqueado(base44)) {
      return Response.json({ sucesso: false, motivo: 'circuit_breaker' });
    }

    // Buscar pedidos que podem estar desatualizados:
    // - status "faturado" mas sem numero_nota_fiscal (NF não emitida, pode ter sido cancelado)
    // - status "liberado" com omie_codigo_pedido (já no Omie, pode ter sido cancelado)
    const faturadosSemNF = await base44.asServiceRole.entities.Pedido.filter(
      { status: 'faturado', status_faturamento: 'pendente' }, '-updated_date', 100
    ).catch(() => []);

    const liberadosComOmie = await base44.asServiceRole.entities.Pedido.filter(
      { status: 'liberado', omie_enviado: true }, '-updated_date', 50
    ).catch(() => []);

    // Combinar e filtrar apenas os que têm código Omie
    const candidatos = [...faturadosSemNF, ...liberadosComOmie]
      .filter(p => p.omie_codigo_pedido)
      .slice(0, LOTE);

    if (candidatos.length === 0) {
      return Response.json({ sucesso: true, verificados: 0, mensagem: 'Nenhum pedido para reconciliar' });
    }

    console.log(`[RECONCILIAÇÃO] Verificando ${candidatos.length} pedidos no Omie...`);

    let verificados = 0;
    let canceladosDetectados = 0;
    let erros = 0;
    const detalhes = [];

    for (const pedido of candidatos) {
      try {
        const omie = await consultarPedidoOmie(base44, pedido.omie_codigo_pedido);
        const cab = omie?.cabecalho || {};
        const etapaOmie = String(cab.etapa || '');
        const cancelado = cab.cancelado === true || cab.cancelado === 'S' || etapaOmie === 'cancelado';

        if (cancelado && pedido.status !== 'cancelado') {
          // DIVERGÊNCIA DETECTADA: cancelado no Omie, ativo no local
          console.log(`[RECONCILIAÇÃO] Pedido ${pedido.numero_pedido} (Omie ${pedido.omie_codigo_pedido}) CANCELADO no Omie, local status=${pedido.status}`);

          await base44.asServiceRole.entities.Pedido.update(pedido.id, {
            status: 'cancelado',
            data_cancelamento: new Date().toISOString(),
            motivo_cancelamento: `Cancelado no Omie (detectado por reconciliação automática)`,
            status_faturamento: 'pendente'
          });

          // Cancelar itens de fila pendentes desse pedido
          const filaItems = await base44.asServiceRole.entities.FilaCargaOmie.filter(
            { codigo_pedido_omie: String(pedido.omie_codigo_pedido), status: 'pendente' }
          ).catch(() => []);
          for (const item of filaItems) {
            await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
              status: 'erro',
              erro_log: 'Pedido cancelado no Omie (reconciliação)',
              processado_em: new Date().toISOString()
            }).catch(() => {});
          }

          // Registrar no log gerencial
          await base44.asServiceRole.functions.invoke('registrarLogGerencial', {
            tipo: 'reconciliacao_cancelamento',
            descricao: `Pedido ${pedido.numero_pedido} (tipo: ${pedido.tipo}) cancelado no Omie detectado por reconciliação. Carga: ${pedido.numero_carga || 'N/A'}. Status local anterior: ${pedido.status}.`,
            pedido_id: pedido.id,
            carga_id: pedido.carga_id
          }).catch(() => {});

          // Remover do espelho se existir
          const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
            { codigo_pedido: String(pedido.omie_codigo_pedido) }
          ).catch(() => []);
          for (const esp of espelhos) {
            await base44.asServiceRole.entities.PedidoLiberadoOmie.delete(esp.id).catch(() => {});
          }

          canceladosDetectados++;
          detalhes.push({
            pedido_id: pedido.id,
            numero_pedido: pedido.numero_pedido,
            tipo: pedido.tipo,
            carga: pedido.numero_carga,
            acao: 'cancelado_localmente'
          });
        }

        verificados++;
      } catch (e) {
        if (e.bloqueio) {
          console.error(`[RECONCILIAÇÃO] API Omie bloqueada — abortando`);
          break;
        }
        if (e.retry) {
          console.warn(`[RECONCILIAÇÃO] Rate limit — esperando...`);
          await sleep(3000);
          erros++;
          continue;
        }
        console.error(`[RECONCILIAÇÃO] Erro no pedido ${pedido.numero_pedido}: ${e.message}`);
        erros++;
      }

      if (verificados < candidatos.length) await sleep(DELAY_ENTRE_CONSULTAS_MS);
    }

    console.log(`[RECONCILIAÇÃO] Concluído: ${verificados} verificados, ${canceladosDetectados} cancelados detectados, ${erros} erros`);

    return Response.json({
      sucesso: true,
      verificados,
      cancelados_detectados: canceladosDetectados,
      erros,
      detalhes
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});