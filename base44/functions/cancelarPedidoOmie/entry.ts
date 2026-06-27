import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function getOmieCredentials(base44) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) return { blocked: false };
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

// omieCall canônico (canal único ao Omie). Auto-contido. Espera longa (~55s) em "consumo
// redundante"; bloqueio abre o circuit breaker. Mantém o comportamento "sem retry" curto:
// o chamador espera throw na faultstring (tratado no catch do handler com mensagens amigáveis).
async function omieCall(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [55000, 55000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 500 && /redundante/i.test(corpo)) {
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        }
        if (res.status === 425) {
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
        }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
        }
        throw new Error(data.faultstring);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && /redundante/i.test(lastErr) && !lastErr.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}

const ETAPAS_CANCELAVEIS = ['10', '20'];
const ETAPA_NOMES = { '10': 'Pedido de Venda', '20': 'Pedidos Liberados', '50': 'Faturar', '60': 'Faturado' };

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { pedido_id, motivo, confirmar_massa } = await req.json();
    if (!pedido_id) return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
    if (!motivo || !motivo.trim()) return Response.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 });

    // 🛡️ TRAVA ANTI-MASSA: conta quantos pedidos o MESMO usuário cancelou nos últimos 2 minutos.
    // Se >= 12 e o request não trouxer confirmar_massa:true, pausa para evitar exclusão acidental em massa.
    // Em qualquer erro aqui, apenas loga e prossegue — não pode quebrar um cancelamento legítimo.
    if (!confirmar_massa) {
      try {
        const LIMITE_MASSA = 12;
        const JANELA_MS = 2 * 60 * 1000;
        const recentes = await base44.asServiceRole.entities.Pedido.filter(
          { status: 'cancelado', cancelado_por: user.email }, '-data_cancelamento', 50
        );
        const corte = Date.now() - JANELA_MS;
        const canceladosRecentes = (recentes || []).filter(p =>
          p.data_cancelamento && new Date(p.data_cancelamento).getTime() >= corte
        ).length;

        if (canceladosRecentes >= LIMITE_MASSA) {
          return Response.json({
            sucesso: false,
            bloqueado_massa: true,
            cancelados_recentes: canceladosRecentes,
            error: `Proteção de segurança: você cancelou ${canceladosRecentes} pedidos nos últimos 2 minutos. Cancelamento pausado para evitar engano em massa. Se for intencional, confirme novamente.`
          }, { status: 429 });
        }
      } catch (travaErr) {
        console.warn('[cancelarPedidoOmie] Trava anti-massa falhou (prosseguindo):', travaErr?.message);
      }
    }

    const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
    if (!pedido) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });

    let omieCancelado = false;
    let etapaAtual = null;
    let etapaNome = null;

    if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
      const codigoPedido = Number(pedido.omie_codigo_pedido);

      // Verificar etapa pelo espelho local (evita chamada extra ao Omie)
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
        { codigo_pedido: String(codigoPedido) }, '-created_date', 1
      ).catch(() => []);
      const espelho = espelhos?.[0];

      if (espelho) {
        etapaAtual = espelho.etapa;
        etapaNome = ETAPA_NOMES[etapaAtual] || `Etapa ${etapaAtual}`;

        if (etapaAtual === 'cancelado' || espelho.status_real === 'cancelada') {
          omieCancelado = true;
        } else if (!ETAPAS_CANCELAVEIS.includes(etapaAtual)) {
          return Response.json({
            sucesso: false,
            error: `Não é possível cancelar. Pedido na etapa "${etapaNome}" (${etapaAtual}). Só é possível cancelar nas etapas 10 ou 20.`
          }, { status: 400 });
        }
      }

      // Se não está cancelado, usar ExcluirPedido (método correto para cancelar pedidos nas etapas 10/20)
      if (!omieCancelado) {
        console.log(`[cancelarPedidoOmie] Excluindo pedido ${codigoPedido} no Omie via ExcluirPedido...`);
        await omieCall(base44, 'produtos/pedido/', { codigo_pedido: codigoPedido }, { call: 'ExcluirPedido' });
        omieCancelado = true;
        console.log('[cancelarPedidoOmie] Pedido excluído/cancelado com sucesso no Omie.');
      }
    }

    // Buscar nome do funcionário
    let nomeUsuario = user.full_name || user.email;
    const vendedores = await base44.asServiceRole.entities.Vendedor.filter({ email: user.email }).catch(() => []);
    if (vendedores.length > 0) nomeUsuario = vendedores[0].nome;

    // Atualizar pedido local
    await base44.asServiceRole.entities.Pedido.update(pedido_id, {
      status: 'cancelado',
      cancelado_por: user.email,
      cancelado_por_nome: nomeUsuario,
      data_cancelamento: new Date().toISOString(),
      motivo_cancelamento: motivo.trim()
    });

    // Atualizar espelho local
    if (pedido.omie_codigo_pedido) {
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
        { codigo_pedido: String(pedido.omie_codigo_pedido) }, '-created_date', 1
      ).catch(() => []);
      if (espelhos.length > 0) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
          etapa: 'cancelado',
          status_label: 'Cancelado',
          sincronizado_em: new Date().toISOString(),
          origem_sync: 'reconciliacao'
        }).catch(() => null);
      }
    }

    // Log de integração
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'ExcluirPedido',
      operacao: 'cancelar_pedido',
      entidade_tipo: 'Pedido',
      entidade_id: pedido_id,
      status: 'sucesso',
      usuario_email: user.email
    }).catch(() => null);

    return Response.json({
      sucesso: true,
      omie_cancelado: omieCancelado,
      etapa_cancelada: etapaAtual,
      mensagem: omieCancelado
        ? `Pedido cancelado com sucesso (etapa: ${etapaNome || 'N/A'})`
        : 'Pedido cancelado no sistema (não estava no Omie)'
    });

  } catch (error) {
    const msg = error.message || '';
    const msgLower = msg.toLowerCase();

    // Traduzir erros comuns do Omie para mensagens amigáveis
    if (msgLower.includes('redundante') || msgLower.includes('aguarde')) {
      return Response.json({
        sucesso: false,
        error: 'O Omie está em cooldown para este pedido. Aguarde 1 minuto e tente novamente.'
      }, { status: 429 });
    }
    if (msgLower.includes('não encontrado') || msgLower.includes('not found')) {
      return Response.json({
        sucesso: false,
        error: 'Pedido não encontrado no Omie. Pode já ter sido excluído.'
      }, { status: 404 });
    }

    console.error('[cancelarPedidoOmie] Erro:', msg);
    return Response.json({ error: msg, sucesso: false }, { status: 500 });
  }
});