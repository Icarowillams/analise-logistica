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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
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

        // Rate limit
        await sleep(500);

      } catch (e) {
        if (e.bloqueio) {
          console.error(`[AUDITORIA] API Omie bloqueada — abortando`);
          errosList.push({ motivo: 'API bloqueada por consumo indevido', abortado: true });
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

    const resumo = {
      sucesso: true,
      total_cancelados_encontrados: pedidos.length,
      verificados,
      restaurados,
      sem_nf: semNf,
      nf_cancelada_ou_denegada: nfCancelada,
      erros,
      restaurados_lista: restauradosList,
      erros_lista: errosList,
      valor_total_restaurado: restauradosList.reduce((s, r) => s + (r.valor_total || 0), 0)
    };

    console.log(`[AUDITORIA] Concluído: ${verificados} verificados, ${restaurados} restaurados, ${semNf} sem NF, ${nfCancelada} NF cancelada/denegada, ${erros} erros`);

    return Response.json(resumo);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});