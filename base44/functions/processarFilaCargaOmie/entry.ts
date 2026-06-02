import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_TENTATIVAS = 3;
const LOTE = 5;
const DELAY_ENTRE_PEDIDOS_MS = 5000;

async function resolverCreds(base44) {
  try {
    const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1);
    const cfg = configs?.[0];
    if (cfg?.app_key && cfg?.app_secret) return { app_key: cfg.app_key, app_secret: cfg.app_secret };
  } catch { /* fallback secrets */ }
  return { app_key: Deno.env.get('OMIE_APP_KEY'), app_secret: Deno.env.get('OMIE_APP_SECRET') };
}

// Verifica o circuit breaker persistente. Bloqueado e dentro do prazo → aborta.
async function circuitBreakerBloqueado(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const ctrl = rows?.[0];
  if (ctrl?.bloqueado && ctrl.bloqueado_ate && new Date(ctrl.bloqueado_ate) > new Date()) {
    return { bloqueado: true, bloqueado_ate: ctrl.bloqueado_ate, controle: ctrl };
  }
  if (ctrl?.bloqueado && ctrl.bloqueado_ate && new Date(ctrl.bloqueado_ate) <= new Date()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(ctrl.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => {});
  }
  return { bloqueado: false };
}

// Abre o circuit breaker por 30min ao detectar bloqueio explícito da Omie.
async function abrirBreaker(base44, erro) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const ctrl = rows?.[0];
  const payload = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: String(erro).slice(0, 500), atualizado_em: new Date().toISOString() };
  if (ctrl?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(ctrl.id, payload).catch(() => {});
  else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payload).catch(() => {});
}

// Chamada Omie com retry para erros transitórios. Lança erro com .bloqueio=true em bloqueio explícito.
async function omieCall(base44, call, param) {
  const { app_key, app_secret } = await resolverCreds(base44);
  let lastError = '';
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const res = await fetch(OMIE_PEDIDO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] })
    });
    const data = await res.json();
    if (data.faultstring || data.faultcode) {
      const erro = data.faultstring || 'Erro Omie';
      const msg = String(erro).toLowerCase();
      const faultcode = String(data.faultcode || '').toLowerCase();
      // MISUSE_API_PROCESS → breaker imediato 30min
      if (faultcode.includes('misuse') || msg.includes('misuse') || msg.includes('consumo indevido')) {
        console.error(`[FILA] MISUSE_API_PROCESS detectado! Bloqueando por 30 min.`);
        await abrirBreaker(base44, `MISUSE: ${erro}`);
        const e = new Error(erro); e.bloqueio = true; throw e;
      }
      // Suspensão / chave inválida → breaker 30min
      if (msg.includes('suspens') || msg.includes('inválida') || msg.includes('invalida') || msg.includes('suspended') || res.status === 403) {
        await abrirBreaker(base44, erro);
        const e = new Error(erro); e.bloqueio = true; throw e;
      }
      if (res.status === 425 || msg.includes('bloquead') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
        await abrirBreaker(base44, erro);
        const e = new Error(erro); e.bloqueio = true; throw e;
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon')) {
        lastError = erro; await sleep(2500 * tentativa); continue;
      }
      throw new Error(erro);
    }
    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
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
    await sleep(1200);
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
    const breaker = await circuitBreakerBloqueado(base44);
    if (breaker.bloqueado) {
      return Response.json({ sucesso: false, abortado: true, motivo: 'circuit_breaker', bloqueado_ate: breaker.bloqueado_ate });
    }

    // TIMEOUT: Limpar itens travados em "processando" há mais de 10 minutos
    const TIMEOUT_MS = 10 * 60 * 1000;
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
        console.log(`[FILA TIMEOUT] Pedido ${item.numero_pedido} (carga ${item.numero_carga}) resetado para "${novoStatus}" (tentativa ${tentativas})`);
      }
    }

    const pendentes = await base44.asServiceRole.entities.FilaCargaOmie.filter({ status: 'pendente' }, 'created_date', LOTE).catch(() => []);
    if (!pendentes.length) {
      return Response.json({ sucesso: true, processados: 0, mensagem: 'Nenhum item pendente na fila' });
    }

    console.log(`[FILA] Iniciando processamento de ${pendentes.length} itens:`, pendentes.map(i => ({ pedido: i.numero_pedido, carga: i.numero_carga, status: i.status, tentativas: i.tentativas })));

    const cargasAfetadas = new Set();
    let processados = 0;
    let interrompido = false;

    // Processa SEQUENCIALMENTE (1 por vez, nunca em paralelo).
    for (let i = 0; i < pendentes.length; i++) {
      const item = pendentes[i];
      cargasAfetadas.add(item.carga_id);

      // PROTEÇÃO: Verificar se a carga ainda existe antes de processar
      try {
        const cargas = await base44.asServiceRole.entities.Carga.filter({ id: item.carga_id }, '-created_date', 1);
        if (!cargas || cargas.length === 0) {
          console.log(`[FILA] Carga ${item.carga_id} não existe mais. Cancelando item ${item.numero_pedido}.`);
          await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
            status: 'erro',
            erro_log: 'Carga excluída durante processamento — item cancelado automaticamente',
            processado_em: new Date().toISOString()
          }).catch(() => {});
          processados++;
          continue;
        }
      } catch (e) {
        console.warn(`[FILA] Falha ao verificar carga ${item.carga_id}:`, e.message);
      }

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

    for (const carga_id of cargasAfetadas) {
      await atualizarStatusCarga(base44, carga_id);
    }

    return Response.json({ sucesso: true, processados, interrompido, total_lote: pendentes.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});