import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache = null;

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44, endpoint, param, options = {}) {
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
          const until = new Date(Date.now() + 30 * 60000).toISOString();
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: 'principal', bloqueado: true, bloqueado_ate: until, ultimo_erro: data.faultstring, atualizado_em: new Date().toISOString() }).catch(() => null);
          throw new Error(data.faultstring);
        }
        // "redundante" = rate limit por pedido específico, não vale retry (cada tentativa reseta o timer)
        if (msg.includes('redundante')) { throw new Error(data.faultstring); }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      return data;
    } catch (e) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

// Etapas canceláveis no Omie (10=Pedido, 20=Liberados)
const ETAPAS_CANCELAVEIS = ['10', '20'];
const ETAPA_NOMES = {
  '10': 'Pedido de Venda',
  '20': 'Pedidos Liberados',
  '50': 'Faturar',
  '60': 'Faturado',
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { pedido_id, motivo } = body;

    if (!pedido_id) return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
    if (!motivo || !motivo.trim()) return Response.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 });

    // Buscar pedido no Base44
    const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
    if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });

    let omieCancelado = false;
    let omieErro = null;
    let etapaAtual = null;
    let etapaNome = null;

    // Se o pedido foi enviado ao Omie, verificar etapa via ESPELHO LOCAL (sem chamada extra ao Omie)
    if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
      const codigoPedido = Number(pedido.omie_codigo_pedido);
      console.log('[cancelarPedidoOmie] Pedido Omie:', codigoPedido);

      // 1. Verificar etapa pelo espelho local (PedidoLiberadoOmie) — evita chamada ConsultarPedido
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
        { codigo_pedido: String(codigoPedido) }, '-created_date', 1
      ).catch(() => []);
      const espelho = espelhos?.[0];

      if (espelho) {
        etapaAtual = espelho.etapa;
        etapaNome = ETAPA_NOMES[etapaAtual] || `Etapa ${etapaAtual}`;
        console.log(`[cancelarPedidoOmie] Espelho local: etapa ${etapaAtual} (${etapaNome})`);

        // Já cancelado no espelho?
        if (etapaAtual === 'cancelado' || espelho.status_real === 'cancelada') {
          console.log('[cancelarPedidoOmie] Espelho indica que já está cancelado.');
          omieCancelado = true;
        }
        // Etapa não permite cancelamento?
        else if (!ETAPAS_CANCELAVEIS.includes(etapaAtual)) {
          return Response.json({
            sucesso: false,
            error: `Não é possível cancelar este pedido. Ele está na etapa "${etapaNome}" (${etapaAtual}) no Omie. Só é possível cancelar pedidos nas etapas: Pedido de Venda (10) ou Pedidos Liberados (20).`,
            etapa_atual: etapaAtual,
            etapa_nome: etapaNome
          }, { status: 400 });
        }
      } else {
        // Sem espelho — assumir etapa do pedido local ou permitir tentativa
        console.log('[cancelarPedidoOmie] Sem espelho local. Tentando cancelar direto no Omie.');
      }

      // 2. Se ainda não está cancelado, chamar StatusPedido no Omie (única chamada)
      if (!omieCancelado) {
        console.log('[cancelarPedidoOmie] Cancelando no Omie via StatusPedido...');
        const cancelResult = await omieCall(base44, 'produtos/pedido/', {
          codigo_pedido: codigoPedido,
          cancelar: 'S'
        }, { call: 'StatusPedido', operation: 'cancelar_pedido' });

        if (cancelResult && !cancelResult.faultstring && !cancelResult.faultcode) {
          omieCancelado = true;
          console.log('[cancelarPedidoOmie] Cancelado com sucesso no Omie!');
        } else {
          omieErro = cancelResult?.faultstring || 'Falha ao cancelar no Omie';
          console.error('[cancelarPedidoOmie] Erro Omie:', omieErro);
          return Response.json({
            sucesso: false,
            error: `Erro ao cancelar pedido no Omie: ${omieErro}`,
            etapa_atual: etapaAtual,
            etapa_nome: etapaNome
          }, { status: 400 });
        }
      }
    }

    // Buscar nome do funcionário
    let nomeUsuario = user.full_name || user.email;
    try {
      const vendedores = await base44.asServiceRole.entities.Vendedor.filter({ email: user.email });
      if (vendedores.length > 0) nomeUsuario = vendedores[0].nome;
    } catch (e) { /* fallback full_name */ }

    // Atualizar pedido local como cancelado
    await base44.asServiceRole.entities.Pedido.update(pedido_id, {
      status: 'cancelado',
      cancelado_por: user.email,
      cancelado_por_nome: nomeUsuario,
      data_cancelamento: new Date().toISOString(),
      motivo_cancelamento: motivo.trim(),
      omie_erro: omieErro
    });

    // Atualizar espelho local para refletir cancelamento no Kanban
    if (pedido.omie_codigo_pedido) {
      try {
        const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
          { codigo_pedido: String(pedido.omie_codigo_pedido) }, '-created_date', 1
        );
        if (espelhos.length > 0) {
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
            etapa: 'cancelado',
            status_label: 'Cancelado',
            sincronizado_em: new Date().toISOString(),
            origem_sync: 'reconciliacao'
          });
          console.log('[cancelarPedidoOmie] Espelho atualizado para cancelado');
        }
      } catch (e) {
        console.error('[cancelarPedidoOmie] Erro ao atualizar espelho (não crítico):', e.message);
      }
    }

    return Response.json({
      sucesso: true,
      omie_cancelado: omieCancelado,
      etapa_cancelada: etapaAtual,
      etapa_nome: etapaNome,
      mensagem: omieCancelado
        ? `Pedido cancelado com sucesso (etapa: ${etapaNome || 'N/A'})`
        : 'Pedido cancelado no sistema (não estava no Omie)'
    });

  } catch (error) {
    console.error('[cancelarPedidoOmie] Erro geral:', error.message);
    return Response.json({ error: error.message, sucesso: false }, { status: 500 });
  }
});