import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { checkCircuitBreaker, omieCall as omieCallCentral } from '../_shared/omieClient/entry.ts';

const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_TENTATIVAS = 3;
const LOTE = 25;
const DELAY_ENTRE_PEDIDOS_MS = 800;

function marcarErroBloqueio(error) {
  const msg = String(error?.message || '').toLowerCase();
  const bloqueio =
    msg.includes('circuit breaker') ||
    msg.includes('temporariamente bloqueada') ||
    msg.includes('http 425') ||
    msg.includes('misuse') ||
    msg.includes('consumo indevido') ||
    msg.includes('suspens') ||
    msg.includes('bloquead') ||
    msg.includes('chave de acesso está inválida');

  if (bloqueio) error.bloqueio = true;
  return error;
}

async function omieCall(base44, call, param, entityId = '') {
  try {
    return await omieCallCentral(base44, OMIE_PEDIDO_URL, param, {
      call,
      operation: 'processar_fila_carga_omie',
      entityType: 'FilaCargaOmie',
      entityId,
      throwOnFault: true
    });
  } catch (error) {
    throw marcarErroBloqueio(error instanceof Error ? error : new Error(String(error)));
  }
}

// Idempotência: consulta a etapa atual do pedido no Omie. Se já está na etapa destino
// (ou além), considera concluído sem reprocessar.
async function jaEstaNaEtapa(base44, item) {
  try {
    const param = {};
    if (item.codigo_pedido_omie) param.codigo_pedido = Number(item.codigo_pedido_omie);
    else if (item.codigo_pedido_integracao) param.codigo_pedido_integracao = String(item.codigo_pedido_integracao);
    else return false;

    const resp = await omieCall(base44, 'ConsultarPedido', param, item.id);
    const etapa = String(resp?.pedido_venda_produto?.cabecalho?.etapa || resp?.cabecalho?.etapa || '');
    const destino = String(item.etapa_destino || '50');
    return etapa && Number(etapa) >= Number(destino);
  } catch (e) {
    if (e.bloqueio) throw e;
    return false;
  }
}

// Executa a operação 'faturar': altera previsão + troca etapa para 50.
async function processarFaturar(base44, item) {
  const idParam = {};
  if (item.codigo_pedido_omie) idParam.codigo_pedido = Number(item.codigo_pedido_omie);
  if (item.codigo_pedido_integracao) idParam.codigo_pedido_integracao = String(item.codigo_pedido_integracao);

  if (item.data_previsao) {
    let dataOmie = item.data_previsao;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataOmie)) {
      const [y, m, d] = dataOmie.split('-');
      dataOmie = `${d}/${m}/${y}`;
    }
    await omieCall(base44, 'AlterarPedidoVenda', { cabecalho: { ...idParam, data_previsao: dataOmie } }, item.id);
    await sleep(600);
  }

  await omieCall(base44, 'TrocarEtapaPedido', { ...idParam, etapa: String(item.etapa_destino || '50') }, item.id);
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

    const breaker = await checkCircuitBreaker(base44);
    if (breaker.blocked) {
      return Response.json({ sucesso: false, abortado: true, motivo: 'circuit_breaker', bloqueado_ate: breaker.blockedUntil });
    }

    // ═══ PASSO 1: ATUALIZAR STATUS DE CARGAS ANTES DE PROCESSAR NOVOS PEDIDOS ═══
    const cargasEmAndamento = await base44.asServiceRole.entities.Carga.filter(
      { processamento_omie_status: 'em_andamento' }, '-updated_date', 100
    ).catch(() => []);
    const cargasParciais = await base44.asServiceRole.entities.Carga.filter(
      { processamento_omie_status: 'parcial' }, '-updated_date', 50
    ).catch(() => []);

    const cargasPreAtualizar = [...cargasEmAndamento, ...cargasParciais];
    if (cargasPreAtualizar.length > 0) {
      console.log(`[STATUS] Atualizando status de ${cargasPreAtualizar.length} cargas antes do processamento...`);
      for (const c of cargasPreAtualizar) {
        await atualizarStatusCarga(base44, c.id);
      }
    }

    const cargasNaoIniciadas = await base44.asServiceRole.entities.Carga.filter(
      { processamento_omie_status: 'nao_iniciado' }, '-updated_date', 50
    ).catch(() => []);
    for (const c of cargasNaoIniciadas) {
      const temFila = await base44.asServiceRole.entities.FilaCargaOmie.filter(
        { carga_id: c.id }, '-created_date', 1
      ).catch(() => []);
      if (temFila.length > 0) {
        await atualizarStatusCarga(base44, c.id);
      }
    }

    const cargasProcessando = await base44.asServiceRole.entities.Carga.filter(
      { processamento_omie_status: 'processando' }, '-updated_date', 50
    ).catch(() => []);
    for (const c of cargasProcessando) {
      await atualizarStatusCarga(base44, c.id);
    }

    // ═══ PASSO 2: TIMEOUT — Limpar itens travados em "processando" ═══
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
          erro_log: `Timeout: travado em "processando" por mais de 10 minutos (tentativa ${tentativas})`
        }).catch(() => {});
      }
    }

    // ═══ PASSO 3: LIMPEZA DE ÓRFÃOS ═══
    const todosPendentes = await base44.asServiceRole.entities.FilaCargaOmie.filter({ status: 'pendente' }, 'created_date', 200).catch(() => []);
    if (!todosPendentes.length) {
      return Response.json({ sucesso: true, processados: 0, cargas_pre_atualizadas: cargasPreAtualizar.length, mensagem: 'Nenhum item pendente na fila' });
    }

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
    }

    const pendentes = await base44.asServiceRole.entities.FilaCargaOmie.filter({ status: 'pendente' }, 'created_date', LOTE).catch(() => []);
    if (!pendentes.length) {
      return Response.json({ sucesso: true, processados: 0, orfaos_limpos: orfaosLimpos, mensagem: orfaosLimpos > 0 ? `${orfaosLimpos} itens órfãos limpos, nenhum pendente restante` : 'Nenhum item pendente na fila' });
    }

    const cargasAfetadas = new Set();
    let processados = 0;
    let interrompido = false;

    for (let i = 0; i < pendentes.length; i++) {
      const item = pendentes[i];
      cargasAfetadas.add(item.carga_id);

      await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, { status: 'processando' }).catch(() => {});

      try {
        const jaFeito = await jaEstaNaEtapa(base44, item);
        if (jaFeito) {
          await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, { status: 'concluido', processado_em: new Date().toISOString(), erro_log: '' }).catch(() => {});

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

          if (item.pedido_id) {
            await base44.asServiceRole.entities.Pedido.update(item.pedido_id, { etapa: 'logistica', status_logistico: 'em_carga' }).catch(() => {});
          }

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

        if (e.bloqueio) {
          interrompido = true;
          break;
        }
      }

      if (i < pendentes.length - 1) await sleep(DELAY_ENTRE_PEDIDOS_MS);
    }

    for (const carga_id of cargasAfetadas) {
      await atualizarStatusCarga(base44, carga_id);
    }

    return Response.json({ sucesso: true, processados, interrompido, total_lote: pendentes.length, cargas_pre_atualizadas: cargasPreAtualizar.length, cargas_ciclo_atualizadas: cargasAfetadas.size });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
