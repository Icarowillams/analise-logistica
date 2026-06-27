import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) — canal único ao Omie (portão global) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';
let _credsCache = null;

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) { _credsCache = { appKey: envKey, appSecret: envSecret, at: Date.now() }; return _credsCache; }
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = envKey || String(cfg?.app_key || '').trim();
  const appSecret = envSecret || String(cfg?.app_secret || '').trim();
  _credsCache = { appKey, appSecret, at: Date.now() };
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

async function omieCall(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) { const e = new Error(`API Omie bloqueada até ${cb.blockedUntil}`); e.bloqueio = true; throw e; }
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [55000, 55000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 500 && /redundante/i.test(corpo)) {
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
          throw new Error(lastErr);
        }
        if (res.status === 425) {
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
          const e = new Error(lastErr); e.bloqueio = true; throw e;
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
          const e = new Error(data.faultstring); e.bloqueio = true; throw e;
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error') || msg.includes('chave de acesso') || msg.includes('chave inválid') || msg.includes('chave invalid')) {
          lastErr = data.faultstring;
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e) {
      if (e.bloqueio) throw e;
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

// NF autorizada de um pedido SEM chamar o Omie. ConsultarNF NÃO aceita filtrar por pedido
// (nIdPedido → erro 5001 "Tag não faz parte da estrutura"; só aceita nCodNF/ID interno da NF).
// O número da NF autorizada já está gravado localmente quando o pedido foi faturado
// (PedidoLiberadoOmie.numero_nf / LogEmissaoNF). Lemos do local para proteger o pedido de
// cancelamento indevido sem disparar a chamada inválida.
async function consultarNfDoPedido(base44, codigoPedido) {
  const cod = String(codigoPedido);
  try {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: cod }, '-sincronizado_em', 1).catch(() => []);
    const esp = espelhos?.[0];
    const nfEsp = String(esp?.numero_nf || '').trim();
    const statusReal = String(esp?.status_real || '').toLowerCase();
    if (nfEsp) {
      // Só considera autorizada se o espelho não marca a NF como cancelada/denegada.
      const naoAutorizada = statusReal.includes('cancel') || statusReal.includes('deneg');
      return { autorizada: !naoAutorizada, numero_nf: nfEsp };
    }
  } catch { /* ignora */ }
  try {
    const logs = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: cod, status: 'autorizada' }, '-created_date', 1).catch(() => []);
    const nfLog = String(logs?.[0]?.numero_nf || '').trim();
    if (nfLog) return { autorizada: true, numero_nf: nfLog };
  } catch { /* ignora */ }
  return null;
}

// NOVA VERSÃO: Consulta APENAS pedidos com status 'faturado' para detectar cancelamentos no Omie.
// Todos os outros status (pendente, liberado, montagem) são controlados pelo Logístico Control via webhook.

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Buscar APENAS pedidos faturados que foram enviados ao Omie (sem trocas)
        const pedidosFaturados = await base44.asServiceRole.entities.Pedido.filter({ status: 'faturado', omie_enviado: true });
        const pedidos = pedidosFaturados.filter(p => p.omie_codigo_pedido && p.tipo !== 'troca');

        console.log(`[sincronizarStatusPedidos] Verificando ${pedidos.length} pedidos FATURADOS para detectar cancelamentos`);

        if (pedidos.length === 0) {
            return Response.json({ sucesso: true, total_verificados: 0, atualizados: 0, erros: 0, message: 'Nenhum pedido faturado para verificar' });
        }

        let atualizados = 0;
        let erros = 0;

        for (const pedido of pedidos) {
            try {
                let result;
                try {
                    result = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(pedido.omie_codigo_pedido) }, { call: 'ConsultarPedido', skipLog: true });
                } catch (callErr) {
                    // API bloqueada (consumo indevido/425) — parar imediatamente a sincronização.
                    if (callErr.bloqueio) {
                        console.warn(`[sincronizarStatusPedidos] API Omie BLOQUEADA. Parando sincronização.`);
                        break;
                    }
                    // Demais erros: omieCall lança com a faultstring na mensagem — reaproveita o fluxo abaixo.
                    result = { faultstring: callErr.message };
                }

                if (result && (result.faultstring || result.faultcode)) {
                    const faultMsg = (result.faultstring || '').toLowerCase();
                    
                    // Só considera "excluído/inexistente" — NUNCA inferir cancelamento por texto frouxo.
                    // Cancelamento real vem da etapa/cabecalho.cancelado quando o pedido existe.
                    const isExcluido = faultMsg.includes('não encontrad') || faultMsg.includes('nao encontrad') ||
                                       faultMsg.includes('não cadastrad') || faultMsg.includes('nao cadastrad') ||
                                       faultMsg.includes('excluíd') || faultMsg.includes('excluid') ||
                                       faultMsg.includes('não existe') || faultMsg.includes('nao existe') ||
                                       faultMsg.includes('inexistente');

                    if (isExcluido) {
                        console.log(`[sincronizarStatusPedidos] Pedido #${String(pedido.numero_pedido || '')} (Omie: ${pedido.omie_codigo_pedido}) cancelado/excluído no Omie.`);
                        await base44.asServiceRole.entities.Pedido.update(pedido.id, {
                            status: 'cancelado',
                            motivo_cancelamento: `Cancelado/excluído no Omie (sincronização automática). Omie: ${result.faultstring}`,
                            data_cancelamento: new Date().toISOString(),
                            cancelado_por: 'sistema',
                            cancelado_por_nome: 'Sincronização Automática'
                        });
                        atualizados++;
                    }
                } else if (result && result.pedido_venda_produto) {
                    const etapa = result.pedido_venda_produto.cabecalho?.etapa;
                    const cancelado = result.pedido_venda_produto.infoCadastro?.cancelado;
                    
                    if (cancelado === 'S' || etapa === '80') {
                        // ⚠️ BUG FIX: Verificar NF autorizada antes de cancelar
                        const nfInfo = await consultarNfDoPedido(base44, pedido.omie_codigo_pedido);
                        await new Promise(r => setTimeout(r, 400));

                        if (nfInfo?.autorizada) {
                            console.log(`[sincronizarStatusPedidos] Pedido #${String(pedido.numero_pedido || '')} marcado cancelado no Omie MAS tem NF ${nfInfo.numero_nf} autorizada — mantendo como faturado`);
                            await base44.asServiceRole.entities.Pedido.update(pedido.id, {
                                status: 'faturado',
                                faturado: true,
                                status_faturamento: 'faturado',
                                numero_nota_fiscal: nfInfo.numero_nf,
                                data_faturamento: pedido.data_faturamento || new Date().toISOString()
                            });
                        } else {
                            console.log(`[sincronizarStatusPedidos] Pedido #${String(pedido.numero_pedido || '')} cancelado no Omie (etapa: ${etapa}, cancelado: ${cancelado})`);
                            await base44.asServiceRole.entities.Pedido.update(pedido.id, {
                                status: 'cancelado',
                                motivo_cancelamento: 'Cancelado no Omie (sincronização automática)',
                                data_cancelamento: new Date().toISOString(),
                                cancelado_por: 'sistema',
                                cancelado_por_nome: 'Sincronização Automática'
                            });
                            atualizados++;
                        }
                    }
                    // Não precisa verificar outros status — se está faturado no banco e no Omie, tudo certo
                }

                // Rate limit do Omie
                await new Promise(r => setTimeout(r, 800));

            } catch (pedidoErr) {
                console.error(`[sincronizarStatusPedidos] Erro pedido ${pedido.id}:`, pedidoErr.message);
                erros++;
            }
        }

        console.log(`[sincronizarStatusPedidos] Finalizado. Faturados verificados: ${pedidos.length}, Cancelados detectados: ${atualizados}, Erros: ${erros}`);

        return Response.json({
            sucesso: true,
            total_verificados: pedidos.length,
            atualizados,
            erros
        });

    } catch (error) {
        console.error('[sincronizarStatusPedidos] Erro geral:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});