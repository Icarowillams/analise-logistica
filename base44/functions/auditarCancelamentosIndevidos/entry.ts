import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════
// AUDITORIA DE CANCELAMENTOS INDEVIDOS
// ═══════════════════════════════════════════════════════════════
// Busca todos os pedidos com status "cancelado" + omie_enviado: true.
// Para cada um, consulta ConsultarNF no Omie.
// Se encontrar NF autorizada, restaura o pedido para "faturado".
// ═══════════════════════════════════════════════════════════════

const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function resolverCreds(base44) {
  try {
    const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1);
    const cfg = configs?.[0];
    if (cfg?.app_key && cfg?.app_secret) return { app_key: cfg.app_key, app_secret: cfg.app_secret };
  } catch { /* fallback */ }
  return { app_key: Deno.env.get('OMIE_APP_KEY'), app_secret: Deno.env.get('OMIE_APP_SECRET') };
}

async function consultarNfDoPedido(app_key, app_secret, codigoPedido) {
  try {
    const res = await fetch(OMIE_NF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ConsultarNF', app_key, app_secret, param: [{ nIdPedido: Number(codigoPedido) }] })
    });
    if (res.status >= 500 || res.status === 429 || res.status === 425) {
      const corpo = await res.text().catch(() => '');
      const e = new Error(`HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`);
      if (res.status === 425) e.bloqueio = true; else e.retry = true;
      throw e;
    }
    const data = await res.json();
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      if (msg.includes('consumo indevido') || msg.includes('bloquead')) {
        const e = new Error(data.faultstring); e.bloqueio = true; throw e;
      }
      if (msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante')) {
        const e = new Error(data.faultstring); e.retry = true; throw e;
      }
      return null; // NF não encontrada
    }
    if (!data?.ide?.nNF) return null;
    const dCan = String(data.ide?.dCan || '').trim();
    const cDeneg = String(data.ide?.cDeneg || '').trim();
    return {
      autorizada: !dCan && cDeneg !== 'S' && cDeneg !== 'D',
      numero_nf: String(data.ide.nNF),
      data_emissao: data.ide?.dEmi || ''
    };
  } catch (e) {
    if (e.bloqueio || e.retry) throw e;
    return null;
  }
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

    const { app_key, app_secret } = await resolverCreds(base44);

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
        const nfInfo = await consultarNfDoPedido(app_key, app_secret, pedido.omie_codigo_pedido);
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