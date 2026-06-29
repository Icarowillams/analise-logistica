import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════
// AUDITORIA DE CANCELAMENTOS INDEVIDOS
// ═══════════════════════════════════════════════════════════════
// Busca todos os pedidos com status "cancelado" + omie_enviado: true.
// Para cada um, consulta ConsultarNF no Omie.
// Se encontrar NF autorizada, restaura o pedido para "faturado".
// ═══════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function resolverCreds(base44) {
  // ENV PRIMEIRO (fonte de verdade). Banco só como fallback.
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { app_key: envKey, app_secret: envSecret };
  const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = configs?.[0];
  return { app_key: envKey || cfg?.app_key, app_secret: envSecret || cfg?.app_secret };
}

// NF autorizada de um pedido SEM chamar o Omie. ConsultarNF NÃO aceita filtrar por pedido
// (nIdPedido → erro 5001 "Tag não faz parte da estrutura"; só aceita nCodNF/ID interno da NF).
// O número da NF autorizada já está gravado localmente quando o pedido foi faturado
// (PedidoLiberadoOmie.numero_nf / LogEmissaoNF) — lemos do local para decidir restauração.
async function consultarNfDoPedido(base44, codigoPedido) {
  const cod = String(codigoPedido);
  try {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: cod }, '-sincronizado_em', 1).catch(() => []);
    const esp = espelhos?.[0];
    const nfEsp = String(esp?.numero_nf || '').trim();
    const statusReal = String(esp?.status_real || '').toLowerCase();
    if (nfEsp) {
      const naoAutorizada = statusReal.includes('cancel') || statusReal.includes('deneg');
      return { autorizada: !naoAutorizada, numero_nf: nfEsp, data_emissao: '' };
    }
  } catch { /* ignora */ }
  try {
    const logs = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: cod, status: 'autorizada' }, '-created_date', 1).catch(() => []);
    const nfLog = String(logs?.[0]?.numero_nf || '').trim();
    if (nfLog) return { autorizada: true, numero_nf: nfLog, data_emissao: '' };
  } catch { /* ignora */ }
  return null;
}

async function verificarCircuitBreaker(base44) {
  const _cbId = '6a1e06a9aa62ceab7b3b6d97';
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ id: _cbId }, '-created_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    return { bloqueado: true, bloqueado_ate: controle.bloqueado_ate, id: _cbId };
  }
  return { bloqueado: false, id: _cbId };
}

async function ativarCircuitBreaker(base44, controleId, faultstring) {
  const _cbId = '6a1e06a9aa62ceab7b3b6d97';
  const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
  const _cb = _cbRows?.[0];
  const _erros = (_cb?.erros_consecutivos || 0) + 1;
  const _thresh = _cb?.threshold_erros ?? 3;
  const payload: any = { erros_consecutivos: _erros, ultimo_erro: String(faultstring || '').slice(0, 500), atualizado_em: new Date().toISOString() };
  if (_erros >= _thresh) {
    payload.bloqueado = true;
    payload.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString();
  }
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, payload).catch(() => {});
  return payload.bloqueado_ate || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // ── Verificar circuit breaker ANTES de começar ──
    const cb = await verificarCircuitBreaker(base44);
    if (cb.bloqueado) {
      console.warn(`[AUDITORIA] Circuit breaker ativo — bloqueado até ${cb.bloqueado_ate}`);
      return Response.json({
        sucesso: false,
        motivo: 'circuit_breaker_ativo',
        bloqueado_ate: cb.bloqueado_ate,
        mensagem: `API Omie bloqueada até ${new Date(cb.bloqueado_ate).toLocaleString('pt-BR')}. Tente novamente após o desbloqueio.`
      });
    }

    // Buscar TODOS os pedidos cancelados com omie_enviado: true (paginado)
    const BATCH = 50;
    let allPedidos = [];
    let skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Pedido.filter(
        { status: 'cancelado', omie_enviado: true }, '-created_date', BATCH, skip
      );
      allPedidos = allPedidos.concat(batch);
      if (batch.length < BATCH) break;
      skip += BATCH;
    }

    // Filtrar apenas os que têm omie_codigo_pedido
    const pedidos = allPedidos.filter(p => p.omie_codigo_pedido);
    console.log(`[AUDITORIA] ${pedidos.length} pedidos cancelados com omie_enviado=true encontrados`);

    let verificados = 0;
    let restaurados = 0;
    let semNf = 0;
    let nfCancelada = 0;
    let erros = 0;
    let bloqueadoAte = null;
    const restauradosList = [];
    const errosList = [];

    for (const pedido of pedidos) {
      try {
        const nfInfo = await consultarNfDoPedido(base44, pedido.omie_codigo_pedido);
        verificados++;

        if (!nfInfo) {
          semNf++;
        } else if (nfInfo.autorizada) {
          // NF autorizada! Restaurar pedido
          await base44.asServiceRole.entities.Pedido.update(pedido.id, {
            status: 'faturado',
            faturado: true,
            status_faturamento: 'faturado',
            numero_nota_fiscal: nfInfo.numero_nf,
            data_faturamento: pedido.data_faturamento || new Date().toISOString(),
            motivo_cancelamento: `[RESTAURADO] Cancelamento indevido corrigido — NF ${nfInfo.numero_nf} autorizada. Motivo original: ${(pedido.motivo_cancelamento || '').slice(0, 200)}`
          });

          await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'auditoria',
            call: 'restauracao_cancelamento_indevido',
            operacao: 'restauracao_cancelamento_indevido',
            entidade_tipo: 'Pedido',
            entidade_id: pedido.id,
            status: 'sucesso',
            mensagem_erro: `Pedido ${pedido.numero_pedido} restaurado de cancelado para faturado — NF ${nfInfo.numero_nf} autorizada`,
            payload_resposta: JSON.stringify({
              pedido_id: pedido.id,
              numero_pedido: pedido.numero_pedido,
              omie_codigo_pedido: pedido.omie_codigo_pedido,
              numero_nf: nfInfo.numero_nf,
              motivo_cancelamento_original: pedido.motivo_cancelamento,
              cancelado_por_original: pedido.cancelado_por_nome || pedido.cancelado_por
            }).slice(0, 2000),
            usuario_email: user.email
          }).catch(() => {});

          restaurados++;
          restauradosList.push({
            pedido_id: pedido.id,
            numero_pedido: pedido.numero_pedido,
            omie_codigo_pedido: pedido.omie_codigo_pedido,
            cliente_nome: pedido.cliente_nome || pedido.cliente_nome_fantasia,
            numero_nf: nfInfo.numero_nf,
            motivo_cancelamento_original: pedido.motivo_cancelamento,
            cancelado_por: pedido.cancelado_por_nome || pedido.cancelado_por,
            valor_total: pedido.valor_total
          });

          console.log(`[AUDITORIA] RESTAURADO: Pedido ${pedido.numero_pedido} → NF ${nfInfo.numero_nf}`);
        } else {
          nfCancelada++;
        }

        // Rate limit — 300ms entre chamadas (padrão do sistema)
        await sleep(300);

      } catch (e) {
        if (e.bloqueio) {
          // ── Persistir circuit breaker na entidade ──
          bloqueadoAte = await ativarCircuitBreaker(base44, cb.id, e.message);
          console.error(`[AUDITORIA] API Omie bloqueada — circuit breaker ativado até ${bloqueadoAte}`);

          await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'auditoria',
            call: 'auditarCancelamentosIndevidos',
            operacao: 'auditoria_cancelamentos',
            status: 'erro',
            codigo_erro: '425',
            mensagem_erro: `Circuit breaker ativado após ${verificados} verificações — bloqueado até ${bloqueadoAte}`,
            usuario_email: user.email
          }).catch(() => {});

          break;
        }
        if (e.retry) {
          console.warn(`[AUDITORIA] Rate limit — esperando 3s...`);
          await sleep(3000);
          erros++;
          continue;
        }
        console.error(`[AUDITORIA] Erro no pedido ${pedido.numero_pedido}: ${e.message}`);
        erros++;
        errosList.push({ pedido: pedido.numero_pedido, erro: e.message });
      }
    }

    const totalRestantes = pedidos.length - verificados;
    const concluiu = !bloqueadoAte && totalRestantes === 0;

    const resumo = {
      sucesso: concluiu,
      parcial: !concluiu && verificados > 0,
      total_cancelados_encontrados: pedidos.length,
      verificados,
      restaurados,
      sem_nf: semNf,
      nf_cancelada_ou_denegada: nfCancelada,
      erros,
      restantes: totalRestantes,
      restaurados_lista: restauradosList,
      erros_lista: errosList,
      valor_total_restaurado: restauradosList.reduce((s, r) => s + (r.valor_total || 0), 0),
      ...(bloqueadoAte ? { motivo: 'circuit_breaker_ativado', bloqueado_ate: bloqueadoAte } : {})
    };

    console.log(`[AUDITORIA] Concluído: ${verificados} verificados, ${restaurados} restaurados, ${semNf} sem NF, ${nfCancelada} NF cancelada/denegada, ${erros} erros, ${totalRestantes} restantes`);

    return Response.json(resumo);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});