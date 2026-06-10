import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

// ID fixo do único registro de circuit breaker — NUNCA criar novos
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

// ✅ ITEM 7
// ═══════════════════════════════════════════════════════════════
// RECONCILIAÇÃO PERIÓDICA: Pedidos locais vs Omie
// ═══════════════════════════════════════════════════════════════
// Verifica pedidos com status "faturado" ou "liberado" no local
// que podem ter sido cancelados no Omie sem notificação por webhook.
// ⚠️ BONIFICAÇÕES: o Omie marca bonificações como "cancelado" na API
// após emitir a NF (encerramento de fluxo comercial), mas a NF é VÁLIDA.
// Antes de cancelar localmente, consulta a NF do pedido.
// Roda a cada 30 min (automação agendada).
// ═══════════════════════════════════════════════════════════════

const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const LOTE = 20; // Pedidos por ciclo
const DELAY_ENTRE_CONSULTAS_MS = 1500; // Mínimo seguro para evitar bloqueio Omie


async function circuitBreakerBloqueado(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const ctrl = rows?.[0];
  if (ctrl?.bloqueado && ctrl.bloqueado_ate && new Date(ctrl.bloqueado_ate) > new Date()) {
    return true;
  }
  return false;
}

async function omieCallRaw(base44, url, call, param) {
  // Extrai o endpoint relativo da URL completa do Omie
  // Ex: 'https://app.omie.com.br/api/v1/produtos/pedido/' → 'produtos/pedido/'
  const endpoint = url.replace('https://app.omie.com.br/api/v1/', '');
  return omieCall(base44, endpoint, param, { call });
}

async function consultarPedidoOmie(base44, codigoPedido) {
  const data = await omieCallRaw(base44, OMIE_PEDIDO_URL, 'ConsultarPedido', { codigo_pedido: Number(codigoPedido) });
  return data.pedido_venda_produto || data;
}

// Consulta NF vinculada a um pedido Omie. Retorna { autorizada, numero_nf } ou null.
async function consultarNfDoPedido(base44, codigoPedido) {
  try {
    const data = await omieCallRaw(base44, OMIE_NF_URL, 'ConsultarNF', { nIdPedido: Number(codigoPedido) });
    if (!data?.ide?.nNF) return null;
    const dCan = String(data.ide?.dCan || '').trim();
    const cDeneg = String(data.ide?.cDeneg || '').trim();
    const cancelada = dCan && dCan !== '';
    const denegada = cDeneg === 'S' || cDeneg === 'D';
    return {
      autorizada: !cancelada && !denegada,
      numero_nf: String(data.ide.nNF),
      chave_nfe: data.compl?.cChaveNFe || '',
      data_emissao: data.ide?.dEmi || ''
    };
  } catch {
    return null; // NF não encontrada ou erro de consulta
  }
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

    // Pedidos pendentes enviados ao Omie: podem ter avançado de etapa sem webhook chegar
    const pendentesComOmie = await base44.asServiceRole.entities.Pedido.filter(
      { status: 'pendente', omie_enviado: true }, '-updated_date', 50
    ).catch(() => []);

    // Combinar e filtrar apenas os que têm código Omie
    const candidatos = [...faturadosSemNF, ...liberadosComOmie, ...pendentesComOmie]
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
          // ⚠️ BUG FIX: Antes de cancelar, verificar se existe NF autorizada.
          // O Omie pode reportar cancelado === true mas ter NF válida (ex: bonificações, encerramento de fluxo).
          const nfInfo = await consultarNfDoPedido(base44, pedido.omie_codigo_pedido);
          await sleep(DELAY_ENTRE_CONSULTAS_MS);

          if (nfInfo?.autorizada) {
            // NF autorizada — NÃO cancelar, restaurar/manter como faturado
            console.log(`[RECONCILIAÇÃO] Pedido ${pedido.numero_pedido} marcado cancelado no Omie MAS tem NF ${nfInfo.numero_nf} autorizada — sincronizando como faturado`);
            await base44.asServiceRole.entities.Pedido.update(pedido.id, {
              status: 'faturado',
              faturado: true,
              status_faturamento: 'faturado',
              numero_nota_fiscal: nfInfo.numero_nf,
              data_faturamento: pedido.data_faturamento || new Date().toISOString()
            });
            await base44.asServiceRole.entities.LogIntegracaoOmie.create({
              endpoint: 'reconciliacao', call: 'protecao_nf_autorizada', operacao: 'reconciliar_status',
              entidade_tipo: 'Pedido', entidade_id: pedido.id, status: 'sucesso',
              mensagem_erro: `Reconciliação: cancelamento ignorado — NF ${nfInfo.numero_nf} autorizada`,
              payload_resposta: JSON.stringify({ numero_pedido: pedido.numero_pedido, numero_nf: nfInfo.numero_nf }).slice(0, 2000)
            }).catch(() => {});
            detalhes.push({
              pedido_id: pedido.id, numero_pedido: pedido.numero_pedido, tipo: pedido.tipo,
              carga: pedido.numero_carga, acao: 'protegido_nf_autorizada', numero_nf: nfInfo.numero_nf
            });
            verificados++;
            continue;
          }

          // DIVERGÊNCIA REAL: cancelado no Omie sem NF autorizada
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

        // Avanço de etapa: pedido avançou no Omie mas o webhook foi perdido/descartado
        if (!cancelado) {
          let novoStatus = null;
          if (etapaOmie === '20' && pedido.status === 'pendente') novoStatus = 'liberado';
          else if (etapaOmie === '50' && (pedido.status === 'pendente' || pedido.status === 'liberado')) novoStatus = 'montagem';

          if (novoStatus) {
            console.log(`[RECONCILIAÇÃO] Pedido ${pedido.numero_pedido} está em etapa ${etapaOmie} no Omie mas local está '${pedido.status}' — sincronizando para '${novoStatus}'`);
            const updateAvanco: any = { status: novoStatus };
            if (novoStatus === 'liberado') updateAvanco.data_liberacao = new Date().toISOString();
            await base44.asServiceRole.entities.Pedido.update(pedido.id, updateAvanco);
            await base44.asServiceRole.entities.LogIntegracaoOmie.create({
              endpoint: 'reconciliacao', call: 'avanco_etapa', operacao: 'reconciliar_status',
              entidade_tipo: 'Pedido', entidade_id: pedido.id, status: 'sucesso',
              mensagem_erro: `Reconciliação: etapa avançada para ${etapaOmie} (${novoStatus}) — webhook perdido`,
              payload_resposta: JSON.stringify({ numero_pedido: pedido.numero_pedido, etapa_omie: etapaOmie, status_anterior: pedido.status }).slice(0, 2000)
            }).catch(() => {});
            detalhes.push({ pedido_id: pedido.id, numero_pedido: pedido.numero_pedido, tipo: pedido.tipo, acao: `avancado_${novoStatus}`, etapa_omie: etapaOmie });
          }

          // Corrigir espelho PedidoLiberadoOmie se etapa está desatualizada.
          // Caso típico: webhook EtapaAlterada não chegou após liberação — espelho ficou em '10'.
          if (etapaOmie === '20' && pedido.status === 'liberado') {
            const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
              { codigo_pedido: String(pedido.omie_codigo_pedido) }
            ).catch(() => []);
            for (const esp of espelhos) {
              if (esp.etapa !== '20') {
                await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
                  etapa: '20',
                  sincronizado_em: new Date().toISOString(),
                  origem_sync: 'reconciliacao'
                }).catch(() => {});
                console.log(`[RECONCILIAÇÃO] Espelho do pedido ${pedido.numero_pedido} corrigido para etapa 20 (estava ${esp.etapa})`);
                detalhes.push({ pedido_id: pedido.id, numero_pedido: pedido.numero_pedido, tipo: pedido.tipo, acao: 'espelho_etapa_corrigida', etapa_omie: etapaOmie });
              }
            }
          }
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