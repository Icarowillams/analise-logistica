import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7: migrado para _shared/omieClient — circuit breaker, throttle, retry, timeout, log centralizados
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

// ✅ OMIE_PEDIDO_URL removida — gerenciada pelo _shared/omieClient
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_TENTATIVAS = 3;
const LOTE = 25;
const DELAY_ENTRE_PEDIDOS_MS = 800;

// ✅ resolverCreds removido — getOmieCredentials do _shared/omieClient usado via omieCallShared

// ✅ circuitBreakerBloqueado removido — checkCircuitBreaker do _shared/omieClient

// ✅ abrirBreaker removido — setCircuitBreakerBlocked do _shared/omieClient

// ✅ omieCall local removida — usa omieCallShared do _shared/omieClient
// Wrapper local que adapta a assinatura (call, param) para o padrão (base44, endpoint, param, { call })
async function omieCall(base44, call, param) {
  return omieCallShared(base44, 'produtos/pedido/', param, { call, skipLog: false });
}

// Idempotência: consulta a etapa atual do pedido no Omie. Se já está na etapa destino
// (ou além), considera concluído sem reprocessar.
async function jaEstaNaEtapa(base44, item) {
  try {
    const param = {};
    if (item.codigo_pedido_omie) param.codigo_pedido = Number(item.codigo_pedido_omie);
    else if (item.codigo_pedido_integracao) param.codigo_pedido_integracao = String(item.codigo_pedido_integracao);
    else return false;
    const resp = await omieCall(base44, 'ConsultarPedido', param);
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
    await omieCall(base44, 'AlterarPedidoVenda', {
      cabecalho: { ...idParam, data_previsao: dataOmie }
    });
    await sleep(600);
  }

  // 2) Trocar etapa para destino (50)
  await omieCall(base44, 'TrocarEtapaPedido', { ...idParam, etapa: String(item.etapa_destino || '50') });
}

// Recalcula o status de processamento da carga a partir dos itens da fila.
async function atualizarStatusCarga(base44, carga_id) {
  const itens = await base44.asServiceRole.entities.FilaCargaOmie.filter({ carga_id }, '-created_date', 500).catch(() => []);
  if (!itens.length) return;
  const total = itens.length;
  const concluidos = itens.filter(i => i.status === 'concluido').length;
  const erros = itens.filter(i => i.status === 'erro').length;
  const pendentesOuProc = itens.filter(i => i.status === 'pendente' || i.status === 'processando').length;

  let status;
  if (concluidos === total) status = 'concluido';
  else if (pendentesOuProc > 0) status = 'em_andamento';
  else if (erros > 0) status = 'parcial';
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

    // ═══ PASSO 1: ATUALIZAR STATUS DE CARGAS (otimizado) ═══
    // 🐛 FIX item4: era 4 queries sequenciais + N loops com 1 query por carga (N+1).
    // Agora: 2 queries em paralelo + filtro em memória + Promise.all para recalcular.
    {
      const [cargasIntermediarias, filaItens] = await Promise.all([
        base44.asServiceRole.entities.Carga.list('-updated_date', 300).catch(() => []),
        base44.asServiceRole.entities.FilaCargaOmie.list('created_date', 500).catch(() => [])
      ]);
      const STATUS_INTERMEDIARIOS = new Set(['em_andamento', 'parcial', 'nao_iniciado', 'processando']);
      const cargaIdsComFila = new Set(filaItens.filter(i => i.status === 'pendente').map(i => i.carga_id));

      const cargasParaAtualizar = cargasIntermediarias.filter(c => {
        if (!STATUS_INTERMEDIARIOS.has(c.processamento_omie_status)) return false;
        // nao_iniciado: só recalcula se tem itens pendentes na fila
        if (c.processamento_omie_status === 'nao_iniciado') return cargaIdsComFila.has(c.id);
        return true;
      });

      if (cargasParaAtualizar.length > 0) {
        console.log(`[STATUS] Recalculando ${cargasParaAtualizar.length} cargas em paralelo (antes era sequencial com N+1 queries)`);
        await Promise.all(cargasParaAtualizar.map(c => atualizarStatusCarga(base44, c.id)));
      }
    }

    // ═══ PASSO 2: TIMEOUT — Limpar itens travados em "processando" há mais de 10 minutos ═══
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

    // ═══ PASSO 3: LIMPEZA DE ÓRFÃOS ═══
    const todosPendentes = await base44.asServiceRole.entities.FilaCargaOmie.filter({ status: 'pendente' }, 'created_date', 200).catch(() => []);
    if (!todosPendentes.length) {
      return Response.json({ sucesso: true, processados: 0, cargas_pre_atualizadas: cargasParaAtualizar.length, mensagem: 'Nenhum item pendente na fila' });
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
        // Idempotência: se já está na etapa destino, conclui sem reprocessar.
        const jaFeito = await jaEstaNaEtapa(base44, item);
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
          await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, { status: 'concluido', processado_em: new Date().toISOString(), erro_log: '' }).catch(() => {});
          // Atualiza pedido local (etapa logística avança)
          if (item.pedido_id) {
            await base44.asServiceRole.entities.Pedido.update(item.pedido_id, { etapa: 'logistica', status_logistico: 'em_carga' }).catch(() => {});
          }
          // Atualiza espelho PedidoLiberadoOmie para refletir a nova etapa imediatamente
          // (evita race condition com a reconciliação agendada)
          if (item.codigo_pedido_omie) {
            const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
              { codigo_pedido: String(item.codigo_pedido_omie) }, '-created_date', 1
            ).catch(() => []);
            if (espelhos?.[0]) {
              await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
                etapa: String(item.etapa_destino || '50'),
                data_previsao: item.data_previsao || espelhos[0].data_previsao,
                sincronizado_em: new Date().toISOString()
              }).catch(() => {});
            }
          }
          processados++;
        }
      } catch (e) {
        console.error(`[FILA ERRO] Pedido ${item.numero_pedido} (carga ${item.numero_carga}):`, e.message);
        const tentativas = Number(item.tentativas || 0) + 1;
        const novoStatus = (e.bloqueio || tentativas >= MAX_TENTATIVAS) ? (e.bloqueio ? 'pendente' : 'erro') : 'pendente';
        await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
          status: novoStatus,
          tentativas,
          erro_log: String(e.message).slice(0, 1000)
        }).catch(() => {});

        // Bloqueio Omie → aborta o restante do lote, retoma na próxima rodada.
        if (e.bloqueio) { interrompido = true; break; }
      }

      // Delay entre pedidos (não no último).
      if (i < pendentes.length - 1) await sleep(DELAY_ENTRE_PEDIDOS_MS);
    }

    // ═══ PASSO FINAL: Atualizar status das cargas tocadas NESTE ciclo ═══
    for (const carga_id of cargasAfetadas) {
      await atualizarStatusCarga(base44, carga_id);
    }

    return Response.json({ sucesso: true, processados, interrompido, total_lote: pendentes.length, cargas_pre_atualizadas: cargasParaAtualizar.length, cargas_ciclo_atualizadas: cargasAfetadas.size });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});