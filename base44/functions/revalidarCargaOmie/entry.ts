import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (somente ConsultarPedido — leitura) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getOmieCreds(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  const appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

// Consulta a etapa atual do pedido no Omie. Retorna número (20/50/60) ou null.
// Retry leve no redundante/aguarde (1 reespera de 3s).
async function consultarEtapa(base44, codigoPedidoOmie) {
  const { appKey, appSecret } = await getOmieCreds(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  const url = OMIE_BASE_URL + 'produtos/pedido/';
  let tentativa = 0;
  while (tentativa < 2) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);
    let data;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call: 'ConsultarPedido', app_key: appKey, app_secret: appSecret, param: [{ codigo_pedido: Number(codigoPedidoOmie) }] }),
        signal: controller.signal
      });
      clearTimeout(tid);
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        if (tentativa === 0) { await sleep(3000); tentativa++; continue; }
        throw new Error(`HTTP ${res.status} Omie`);
      }
      data = await res.json();
    } catch (e) {
      clearTimeout(tid);
      throw new Error(e.name === 'AbortError' ? 'Timeout na chamada Omie' : e.message);
    }
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      if ((msg.includes('redundante') || msg.includes('aguarde')) && tentativa === 0) {
        await sleep(3000); tentativa++; continue;
      }
      throw new Error(data.faultstring);
    }
    const etapa = String(data?.pedido_venda_produto?.cabecalho?.etapa || '');
    return etapa ? Number(etapa) : null;
  }
  return null;
}

// 🔎 REVALIDA uma carga consultando a ETAPA REAL no Omie de cada pedido modelo 55,
// e reenfileira (faturar → 50) os que estiverem < 50 — mesmo que a fila diga "concluído".
// Corrige o "falso sucesso": itens marcados concluido sem terem trocado de etapa.
//
// body: { carga_id: string }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const breaker = await checkCircuitBreaker(base44);
    if (breaker.blocked) {
      return Response.json({ sucesso: false, omie_bloqueada: true, bloqueado_ate: breaker.blockedUntil, error: `API Omie bloqueada até ${breaker.blockedUntil}` }, { status: 425 });
    }

    const body = await req.json().catch(() => ({}));
    const { carga_id } = body;
    if (!carga_id) return Response.json({ error: 'carga_id obrigatório' }, { status: 400 });

    const carga = await base44.asServiceRole.entities.Carga.get(carga_id).catch(() => null);
    if (!carga) return Response.json({ error: 'Carga não encontrada' }, { status: 404 });

    // Pedidos modelo 55 da carga (D1 não tem etapa Omie de NF).
    const pedidosOmie = (carga.pedidos_omie || []).filter(p => p.tipo_nota !== 'D1' && p.codigo_pedido);
    if (pedidosOmie.length === 0) {
      return Response.json({ sucesso: true, mensagem: 'Carga sem pedidos modelo 55 para revalidar.', revalidados: 0, reenfileirados: 0 });
    }

    // Itens da fila desta carga (para reusar ids/dados ao reenfileirar).
    const itensFila = await base44.asServiceRole.entities.FilaCargaOmie.filter({ carga_id }, '-created_date', 500).catch(() => []);
    const filaPorCodigo = new Map();
    for (const it of itensFila) {
      const cod = String(it.codigo_pedido_omie || '');
      if (cod) filaPorCodigo.set(cod, it);
    }

    const detalhes = [];
    let reenfileirados = 0;
    let confirmados = 0;
    let inconclusivos = 0;
    const DELAY_MS = 2500;

    for (let i = 0; i < pedidosOmie.length; i++) {
      const p = pedidosOmie[i];
      const codigo = String(p.codigo_pedido);

      // Re-checa breaker no meio (outra função pode bloquear).
      const mid = await checkCircuitBreaker(base44);
      if (mid.blocked) {
        detalhes.push({ codigo_pedido: codigo, etapa: null, acao: 'abortado', motivo: 'API Omie bloqueada' });
        break;
      }

      let etapa = null;
      try {
        etapa = await consultarEtapa(base44, codigo);
      } catch (e) {
        inconclusivos++;
        detalhes.push({ codigo_pedido: codigo, numero_pedido: p.numero_pedido, etapa: null, acao: 'inconclusivo', motivo: e.message });
        if (i < pedidosOmie.length - 1) await sleep(DELAY_MS);
        continue;
      }

      if (etapa !== null && etapa >= 50) {
        // Já está em 50+ no Omie — confirma o item da fila como concluído de verdade.
        confirmados++;
        const it = filaPorCodigo.get(codigo);
        if (it && it.status !== 'concluido') {
          await base44.asServiceRole.entities.FilaCargaOmie.update(it.id, {
            status: 'concluido', processado_em: new Date().toISOString(), erro_log: '', proxima_tentativa_em: null
          }).catch(() => {});
        }
        detalhes.push({ codigo_pedido: codigo, numero_pedido: p.numero_pedido, etapa, acao: 'confirmado' });
      } else {
        // < 50 → reenfileira faturar. Reusa o item da fila se existir; senão cria um novo.
        const it = filaPorCodigo.get(codigo);
        if (it) {
          await base44.asServiceRole.entities.FilaCargaOmie.update(it.id, {
            status: 'pendente',
            operacao: 'faturar',
            etapa_destino: '50',
            tentativas: 0,
            tentativas_redundante: 0,
            proxima_tentativa_em: null,
            erro_log: `Revalidação: etapa real ${etapa ?? '?'} < 50 — reenfileirado.`
          }).catch(() => {});
        } else {
          await base44.asServiceRole.entities.FilaCargaOmie.create({
            carga_id,
            numero_carga: carga.numero_carga || '',
            pedido_id: p.pedido_id || '',
            codigo_pedido_omie: codigo,
            codigo_pedido_integracao: p.codigo_pedido_integracao || '',
            numero_pedido: p.numero_pedido || '',
            data_previsao: carga.data_carga || '',
            operacao: 'faturar',
            etapa_destino: '50',
            status: 'pendente',
            tentativas: 0,
            usuario_email: user.email
          }).catch(() => {});
        }
        reenfileirados++;
        detalhes.push({ codigo_pedido: codigo, numero_pedido: p.numero_pedido, etapa, acao: 'reenfileirado' });
      }

      if (i < pedidosOmie.length - 1) await sleep(DELAY_MS);
    }

    // Recalcula o status de processamento da carga a partir da etapa REAL consultada.
    let novoStatus;
    if (reenfileirados > 0) novoStatus = 'em_andamento';
    else if (inconclusivos > 0) novoStatus = 'parcial';
    else novoStatus = 'concluido';

    await base44.asServiceRole.entities.Carga.update(carga_id, {
      processamento_omie_status: novoStatus
    }).catch(() => {});

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'ConsultarPedido',
      operacao: 'revalidar_carga',
      entidade_tipo: 'Carga',
      entidade_id: carga_id,
      status: 'sucesso',
      mensagem_erro: null,
      payload_resposta: JSON.stringify({ confirmados, reenfileirados, inconclusivos }).slice(0, 800),
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      carga: carga.numero_carga,
      total_modelo55: pedidosOmie.length,
      confirmados,
      reenfileirados,
      inconclusivos,
      novo_status: novoStatus,
      detalhes,
      mensagem: reenfileirados > 0
        ? `${reenfileirados} pedido(s) abaixo da etapa 50 reenfileirados. Serão faturados na próxima rodada da fila (a cada 5 min).`
        : `Todos os ${confirmados} pedido(s) já estão na etapa 50+ no Omie.`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});