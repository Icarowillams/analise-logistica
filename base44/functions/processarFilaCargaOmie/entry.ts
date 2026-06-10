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

async function getCircuitBreakerRecord(base44: any) {
  // Busca DIRETO pelo ID fixo — nunca por filter (que pode pegar duplicados)
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  return rows?.[0] || null;
}

async function checkCircuitBreaker(base44: any) {
  const c = await getCircuitBreakerRecord(base44);
  if (!c?.bloqueado) return { blocked: false, record: c };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false, record: c };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro, record: c };
}

// Extrai segundos de bloqueio da mensagem Omie (ex: "Tente novamente em 1798 segundos.")
function extrairSegundosBloqueio(msg: string): number {
  const match = String(msg).match(/(\d+)\s*segundo/i);
  if (match) return Math.min(Number(match[1]), 1800); // cap 30min
  return 0; // sem tempo informado = não bloqueia
}

// Lock removido — o circuit breaker + processamento sequencial interno já protegem contra abusos.
// O lock baseado em atualizado_em causava falsos positivos (checkCircuitBreaker atualiza o campo ao desbloquear).

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [800, 1500, 3000];
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
        // Erros de BLOQUEIO REAL (conta bloqueada/banida pelo Omie)
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const segsOmie = extrairSegundosBloqueio(data.faultstring);
          { const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh && segsOmie > 0) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + segsOmie * 1000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null); }
          const blockedErr = new Error(data.faultstring);
          blockedErr.bloqueio = true;
          throw blockedErr;
        }
        // Erros de RATE LIMIT temporário (redundante, aguarde, cota) — retry rápido
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_TENTATIVAS = 3;
const LOTE = 50;
const DELAY_ENTRE_PEDIDOS_MS = 2000;


// Idempotência: consulta a etapa atual do pedido no Omie. Se já está na etapa destino
// (ou além), considera concluído sem reprocessar.
async function jaEstaNaEtapa(base44, item) {
  try {
    const param = {};
    if (item.codigo_pedido_omie) param.codigo_pedido = Number(item.codigo_pedido_omie);
    else if (item.codigo_pedido_integracao) param.codigo_pedido_integracao = String(item.codigo_pedido_integracao);
    else return false;
    const resp = await omieCall(base44, 'produtos/pedido/', param, { call: 'ConsultarPedido', skipLog: true });
    const etapa = String(resp?.pedido_venda_produto?.cabecalho?.etapa || resp?.cabecalho?.etapa || '');
    const destino = String(item.etapa_destino || '50');
    return etapa && Number(etapa) >= Number(destino);
  } catch (e) {
    if (e.bloqueio) throw e; // propaga bloqueio
    return false; // qualquer outro erro de consulta: segue para processar normalmente
  }
}

// Executa a operação 'faturar': altera previsão + troca etapa para 50.
async function processarFaturar(base44, item) {
  const idParam = {};
  if (item.codigo_pedido_omie) idParam.codigo_pedido = Number(item.codigo_pedido_omie);
  if (item.codigo_pedido_integracao) idParam.codigo_pedido_integracao = String(item.codigo_pedido_integracao);

  // 1) Alterar previsão de faturamento (se houver data)
  if (item.data_previsao) {
    // Omie exige DD/MM/AAAA — converter de YYYY-MM-DD se necessário
    let dataOmie = item.data_previsao;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataOmie)) {
      const [y, m, d] = dataOmie.split('-');
      dataOmie = `${d}/${m}/${y}`;
    }
    await omieCall(base44, 'produtos/pedido/', {
      cabecalho: { ...idParam, data_previsao: dataOmie }
    }, { call: 'AlterarPedidoVenda' });
    await sleep(300);
  }

  // 2) Trocar etapa para destino (50)
  await omieCall(base44, 'produtos/pedido/', { ...idParam, etapa: String(item.etapa_destino || '50') }, { call: 'TrocarEtapaPedido' });
}

// Recalcula o status de processamento da carga a partir dos itens da fila.
async function atualizarStatusCarga(base44, carga_id) {
  const itens = await base44.asServiceRole.entities.FilaCargaOmie.filter({ carga_id }, '-created_date', 500).catch(() => []);
  if (!itens.length) {
    // Carga tem processamento_omie_status != nao_iniciado mas fila vazia — corrige para nao_iniciado
    return;
  }
  const total = itens.length;
  const concluidos = itens.filter(i => i.status === 'concluido').length;
  const erros = itens.filter(i => i.status === 'erro').length;
  const pendentesOuProc = itens.filter(i => i.status === 'pendente' || i.status === 'processando').length;

  let status;
  if (concluidos === total) status = 'concluido';
  else if (pendentesOuProc > 0) status = 'em_andamento';
  else if (erros > 0 && concluidos + erros === total) status = 'parcial';
  else status = 'em_andamento';

  await base44.asServiceRole.entities.Carga.update(carga_id, {
    processamento_omie_status: status,
    processamento_omie_total: total
  }).catch(() => {});
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Circuit breaker: se bloqueado, aborta toda a execução — tenta na próxima rodada.
    const breaker = await checkCircuitBreaker(base44);
    if (breaker.blocked) {
      return Response.json({ sucesso: false, abortado: true, motivo: 'circuit_breaker', bloqueado_ate: breaker.blockedUntil });
    }

    // ═══ PASSO 0: TIMEOUT — Limpar itens travados em "processando" há mais de 3 minutos ═══
    // DEVE rodar ANTES da checagem de concorrência, senão itens travados bloqueiam a fila indefinidamente.
    const TIMEOUT_MS = 3 * 60 * 1000;
    const travados = await base44.asServiceRole.entities.FilaCargaOmie.filter({ status: 'processando' }, 'updated_date', 50).catch(() => []);
    for (const item of travados) {
      const updatedAt = new Date(item.updated_date).getTime();
      if (Date.now() - updatedAt > TIMEOUT_MS) {
        const tentativas = Number(item.tentativas || 0) + 1;
        const novoStatus = tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente';
        await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
          status: novoStatus,
          tentativas,
          erro_log: `Timeout: travado em "processando" por mais de 3 minutos (tentativa ${tentativas})`
        }).catch(() => {});
        console.log(`[FILA TIMEOUT] Pedido ${item.numero_pedido} (carga ${item.numero_carga}) resetado para "${novoStatus}" (tentativa ${tentativas})`);
      }
    }

    // Proteção contra concorrência: se já tem itens em "processando" recentes (< 2min),
    // outra instância está ativa — aborta para não duplicar chamadas Omie.
    const emProcessamento = await base44.asServiceRole.entities.FilaCargaOmie.filter({ status: 'processando' }, '-updated_date', 1).catch(() => []);
    if (emProcessamento.length > 0) {
      const age = Date.now() - new Date(emProcessamento[0].updated_date).getTime();
      if (age < 2 * 60 * 1000) {
        return Response.json({ sucesso: false, abortado: true, motivo: 'outra_instancia_processando', mensagem: 'Outra instância já está processando a fila. Aguarde.' });
      }
    }

    // ═══ PASSO 1: ATUALIZAR STATUS DE CARGAS (otimizado) ═══
    // Busca em paralelo todas as cargas e itens da fila com limite maior para não perder registros.
    let cargasPreAtualizadasCount = 0;
    {
      const [todasCargas, filaItens] = await Promise.all([
        base44.asServiceRole.entities.Carga.list('-updated_date', 1000).catch(() => []),
        base44.asServiceRole.entities.FilaCargaOmie.list('created_date', 2000).catch(() => [])
      ]);
      const STATUS_INTERMEDIARIOS = new Set(['em_andamento', 'parcial', 'processando', 'nao_iniciado']);
      const cargaIdsComFilaQualquer = new Set(filaItens.map(i => i.carga_id));

      const cargasParaAtualizar = todasCargas.filter(c => {
        // Recalcula cargas em status intermediário ativo QUE tenham itens na fila
        if (STATUS_INTERMEDIARIOS.has(c.processamento_omie_status)) return cargaIdsComFilaQualquer.has(c.id);
        return false;
      });

      cargasPreAtualizadasCount = cargasParaAtualizar.length;
      if (cargasParaAtualizar.length > 0) {
        console.log(`[STATUS] Recalculando ${cargasParaAtualizar.length} cargas em paralelo`);
        await Promise.all(cargasParaAtualizar.map(c => atualizarStatusCarga(base44, c.id)));
      }
    }

    // ═══ PASSO 2: LIMPEZA DE ÓRFÃOS ═══
    const todosPendentes = await base44.asServiceRole.entities.FilaCargaOmie.filter({ status: 'pendente' }, 'created_date', 200).catch(() => []);
    if (!todosPendentes.length) {
      return Response.json({ sucesso: true, processados: 0, cargas_pre_atualizadas: cargasPreAtualizadasCount, mensagem: 'Nenhum item pendente na fila' });
    }

    // Agrupar por carga_id para verificar existência em batch
    const cargaIds = [...new Set(todosPendentes.map(i => i.carga_id).filter(Boolean))];
    const cargasDeletadas = new Set();
    for (const cid of cargaIds) {
      try {
        const existe = await base44.asServiceRole.entities.Carga.filter({ id: cid }, '-created_date', 1);
        if (!existe || existe.length === 0) cargasDeletadas.add(cid);
      } catch {
        cargasDeletadas.add(cid);
      }
    }

    // Cancelar TODOS os itens de cargas deletadas de uma vez
    let orfaosLimpos = 0;
    if (cargasDeletadas.size > 0) {
      const orfaos = todosPendentes.filter(i => cargasDeletadas.has(i.carga_id));
      for (const item of orfaos) {
        await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
          status: 'erro',
          erro_log: 'Carga excluída — item cancelado automaticamente',
          processado_em: new Date().toISOString()
        }).catch(() => {});
      }
      orfaosLimpos = orfaos.length;
      console.log(`[FILA] Limpando ${orfaosLimpos} itens órfãos de ${cargasDeletadas.size} carga(s) deletada(s): ${[...cargasDeletadas].join(', ')}`);
    }

    // Agora buscar os pendentes reais (cargas válidas) para processar
    const pendentes = await base44.asServiceRole.entities.FilaCargaOmie.filter({ status: 'pendente' }, 'created_date', LOTE).catch(() => []);
    if (!pendentes.length) {
      return Response.json({ sucesso: true, processados: 0, orfaos_limpos: orfaosLimpos, mensagem: orfaosLimpos > 0 ? `${orfaosLimpos} itens órfãos limpos, nenhum pendente restante` : 'Nenhum item pendente na fila' });
    }

    console.log(`[FILA] Iniciando processamento de ${pendentes.length} itens:`, pendentes.map(i => ({ pedido: i.numero_pedido, carga: i.numero_carga, status: i.status, tentativas: i.tentativas })));

    const cargasAfetadas = new Set();
    let processados = 0;
    let interrompido = false;

    // Processa SEQUENCIALMENTE (1 por vez, nunca em paralelo).
    for (let i = 0; i < pendentes.length; i++) {
      const item = pendentes[i];
      cargasAfetadas.add(item.carga_id);

      await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, { status: 'processando' }).catch(() => {});

      try {
        // Idempotência: só consulta se já tentou antes (reprocessamento).
        // Pedidos novos (tentativas=0) vão direto para processar, economizando 1 chamada Omie.
        const jaFeito = Number(item.tentativas || 0) > 0 ? await jaEstaNaEtapa(base44, item) : false;
        if (jaFeito) {
          await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, { status: 'concluido', processado_em: new Date().toISOString(), erro_log: '' }).catch(() => {});
          // Garante que o espelho reflita a etapa correta mesmo em reprocessamento
          if (item.codigo_pedido_omie) {
            const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
              { codigo_pedido: String(item.codigo_pedido_omie) }, '-created_date', 1
            ).catch(() => []);
            if (espelhos?.[0] && String(espelhos[0].etapa) !== String(item.etapa_destino || '50')) {
              await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
                etapa: String(item.etapa_destino || '50'),
                sincronizado_em: new Date().toISOString()
              }).catch(() => {});
            }
          }
          processados++;
        } else {
          await processarFaturar(base44, item);
          // Atualiza fila + pedido local + espelho em paralelo (não sequencial)
          const postUpdates = [
            base44.asServiceRole.entities.FilaCargaOmie.update(item.id, { status: 'concluido', processado_em: new Date().toISOString(), erro_log: '' }).catch(() => {})
          ];
          if (item.pedido_id) {
            postUpdates.push(base44.asServiceRole.entities.Pedido.update(item.pedido_id, { etapa: 'logistica', status_logistico: 'em_carga' }).catch(() => {}));
          }
          if (item.codigo_pedido_omie) {
            postUpdates.push(
              base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
                { codigo_pedido: String(item.codigo_pedido_omie) }, '-created_date', 1
              ).then(espelhos => {
                if (espelhos?.[0]) {
                  return base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
                    etapa: String(item.etapa_destino || '50'),
                    data_previsao: item.data_previsao || espelhos[0].data_previsao,
                    sincronizado_em: new Date().toISOString()
                  });
                }
              }).catch(() => {})
            );
          }
          await Promise.all(postUpdates);
          processados++;
        }
      } catch (e) {
        console.error(`[FILA ERRO] Pedido ${item.numero_pedido} (carga ${item.numero_carga}):`, e.message);
        const tentativas = Number(item.tentativas || 0) + 1;
        const isBloqueio = e.bloqueio || /bloqueada|consumo indevido|bloqueio/i.test(e.message);
        const novoStatus = isBloqueio ? 'pendente' : (tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente');
        await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
          status: novoStatus,
          tentativas: isBloqueio ? Number(item.tentativas || 0) : tentativas,
          erro_log: String(e.message).slice(0, 1000)
        }).catch(() => {});

        // Bloqueio Omie → aborta o restante do lote, retoma na próxima rodada.
        if (isBloqueio) { interrompido = true; break; }
      }

      // Delay entre pedidos (não no último).
      if (i < pendentes.length - 1) await sleep(DELAY_ENTRE_PEDIDOS_MS);
    }

    // ═══ PASSO FINAL: Atualizar status das cargas tocadas NESTE ciclo ═══
    for (const carga_id of cargasAfetadas) {
      await atualizarStatusCarga(base44, carga_id);
    }

    return Response.json({ sucesso: true, processados, interrompido, total_lote: pendentes.length, cargas_pre_atualizadas: cargasPreAtualizadasCount, cargas_ciclo_atualizadas: cargasAfetadas.size });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});