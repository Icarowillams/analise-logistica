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

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');


// Deriva status SEFAZ da NF do Omie (mesma lógica do listarNfsOmie)
function derivarStatus(nf) {
  const ide = nf.ide || {};
  const compl = nf.compl || {};
  const nfStatus = nf.nfStatus || {};
  const cStat = String(nfStatus.cStat || compl.cStat || '').trim();
  if (cStat) {
    if (cStat === '101') return 'cancelada';
    if (cStat === '102') return 'inutilizada';
    if (cStat === '110' || cStat === '301' || cStat === '302') return 'denegada';
    if (cStat === '100' || cStat === '135') return 'autorizada';
    return 'rejeitada';
  }
  if (ide.dCan && String(ide.dCan).trim()) return 'cancelada';
  if (ide.cDeneg === 'S' || ide.cDeneg === 'D') return 'denegada';
  if (ide.dInut && String(ide.dInut).trim()) return 'inutilizada';
  return 'pendente';
}

/**
 * Detecta NFs que estavam "autorizada" no Base44 mas que foram CANCELADAS/DENEGADAS no Omie
 * depois (sem webhook chegando). Atualiza Pedido local + LogEmissaoNF.
 *
 * Estratégia: varre os últimos N dias de NFs no Omie, e para cada que retornar cancelada/denegada,
 * atualiza o Pedido local (status=cancelado) e o LogEmissaoNF correspondente.
 */
Deno.serve(async (req) => {
  try {
    if (!APP_KEY || !APP_SECRET) {
      return Response.json({ sucesso: false, erro: 'Credenciais Omie não configuradas' }, { status: 500 });
    }
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Apenas admin' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dias = Math.min(Math.max(Number(body.dias) || 7, 1), 30);

    // Janela: últimos N dias até hoje
    const hoje = new Date();
    const inicio = new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });

    const param = {
      pagina: 1,
      registros_por_pagina: 100,
      dEmiInicial: fmt(inicio),
      dEmiFinal: fmt(hoje)
    };

    let pagina = 1;
    let totalPaginas = 1;
    const canceladas = [];

    do {
      const data = await omieCall(base44, 'ListarNF', { ...param, pagina }, { cacheMinutes: 0 });
      if (data?.faultstring) {
        return Response.json({ sucesso: false, erro: data.faultstring }, { status: 500 });
      }
      totalPaginas = data.nTotPaginas || data.total_de_paginas || 1;
      const nfs = data.nfCadastro || [];
      for (const nf of nfs) {
        const status = derivarStatus(nf);
        if (status === 'cancelada' || status === 'denegada' || status === 'inutilizada') {
          canceladas.push({
            status,
            codigo_pedido: String(nf.compl?.nIdPedido || nf.nIdPedido || ''),
            numero_nf: String(nf.ide?.nNF || nf.cNumero || ''),
            chave_nfe: String(nf.compl?.cChaveNFe || nf.cChaveNFe || '')
          });
        }
      }
      pagina++;
    } while (pagina <= totalPaginas);

    // Reconciliar cada NF cancelada → atualizar Pedido + LogEmissaoNF
    let pedidosAtualizados = 0;
    let logsAtualizados = 0;
    const motivos = { cancelada: 'NF-e cancelada no Omie', denegada: 'NF-e denegada pela SEFAZ', inutilizada: 'NF-e inutilizada no Omie' };

    for (const nfc of canceladas) {
      if (!nfc.codigo_pedido) continue;

      // 1. Atualizar Pedido local
      try {
        const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: nfc.codigo_pedido });
        if (pedidos?.length > 0 && pedidos[0].status !== 'cancelado') {
          await base44.asServiceRole.entities.Pedido.update(pedidos[0].id, {
            status: 'cancelado',
            data_cancelamento: new Date().toISOString(),
            motivo_cancelamento: motivos[nfc.status]
          });
          pedidosAtualizados++;
        }
      } catch (e) {
        console.error(`[reconciliarNfsCanceladasOmie] Falha update Pedido ${nfc.codigo_pedido}:`, e.message);
      }

      // 2. Atualizar LogEmissaoNF (se estava como autorizada)
      try {
        const logs = await base44.asServiceRole.entities.LogEmissaoNF.filter({
          codigo_pedido: nfc.codigo_pedido,
          status: 'autorizada'
        });
        for (const log of logs || []) {
          await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, {
            status: 'rejeitada', // enum não tem 'cancelada' — usar 'rejeitada' com mensagem clara
            mensagem: `[Reconciliação] NF ${nfc.numero_nf} foi ${nfc.status} no Omie após emissão`
          });
          logsAtualizados++;
        }
      } catch (e) {
        console.error(`[reconciliarNfsCanceladasOmie] Falha update LogEmissaoNF ${nfc.codigo_pedido}:`, e.message);
      }
    }

    return Response.json({
      sucesso: true,
      periodo_dias: dias,
      total_nfs_canceladas_no_omie: canceladas.length,
      pedidos_atualizados: pedidosAtualizados,
      logs_atualizados: logsAtualizados
    });
  } catch (error) {
    console.error('[reconciliarNfsCanceladasOmie] Erro:', error.message);
    return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
  }
});