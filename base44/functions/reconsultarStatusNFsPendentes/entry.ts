import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 🔎 RECONSULTA SOB DEMANDA — resolve o status real de NFs "pendentes"/"erro" consultando o Omie AO VIVO.
//
// Filosofia: confiar no Omie em tempo real, não no estado local atrasado.
// Chamada pela tela "Notas Fiscais Omie" (aba Log) — ao carregar e no botão "Resolver N pendente(s)".
// O FRONTEND orquestra os lotes (envia poucos códigos por vez) para nunca estourar o teto de 180s
// e para atualizar a UI conforme cada lote chega. Esta função NÃO tem lock/debounce/cooldown global
// e NÃO faz varredura de 500 — só processa exatamente os codigos_pedido recebidos.
//
// Idempotência: só marca 'autorizada' quando confirmado etapa >= 60 com nNF real.
//   - etapa 50 (SEFAZ processando) → segue 'pendente' (real, resolve no próximo refresh)
//   - rejeitada/denegada/cancelada → 'rejeitada'
//
// body: { codigos_pedido: [string] }  (recomendado: até 4 por chamada)

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

let _credsCache = null;
async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  const appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
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
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

// Chamada Omie com retry curto para redundante/425/429 — sem travar a tela.
async function omieCall(base44, endpoint, param, options = {}) {
  const breaker = await checkCircuitBreaker(base44);
  if (breaker.blocked) { const e = new Error(`API Omie bloqueada até ${breaker.blockedUntil || '?'}`); e.bloqueio = true; throw e; }
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call.');
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [800, 1500];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('misuse')) {
          const e = new Error(data.faultstring); e.bloqueio = true; throw e;
        }
        // Redundante / 425 / 429 / cota / timeout NÃO é erro de NF — é só "espere para consultar de novo".
        // Faz 1 retry curto; se persistir, lança com flag .redundante para o chamador tratar como
        // "ainda processando" (nunca como erro/rejeição) e aplicar backoff.
        if (res.status === 425 || res.status === 429 || msg.includes('redundante') || msg.includes('aguarde') || msg.includes('cota') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) {
          lastErr = data.faultstring;
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
          const e = new Error(data.faultstring); e.redundante = true; throw e;
        }
        // Qualquer outra faultstring = erro real (estrutura, pedido inexistente, etc.)
        throw new Error(data.faultstring);
      }
      return data;
    } catch (e) {
      if (e.bloqueio || e.redundante) throw e;
      if (e.name === 'AbortError') { const te = new Error('Timeout na chamada Omie'); te.redundante = true; throw te; }
      lastErr = e.message;
      if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}

function classificarNF(cStat, numNf, xMotivo) {
  const c = String(cStat || '');
  if (c === '100' || c === '150') return { status_real: 'emitida', numero_nf: String(numNf || ''), codigo_sefaz: c, mensagem: `NF ${numNf} autorizada` };
  if (c === '101' || c === '135') return { status_real: 'cancelada', numero_nf: String(numNf || ''), codigo_sefaz: c, mensagem: `NF ${numNf} cancelada${xMotivo ? ' — ' + xMotivo : ''}` };
  if (['110', '301', '302', '205'].includes(c)) return { status_real: 'denegada', codigo_sefaz: c, mensagem: `NF denegada (${c})${xMotivo ? ' — ' + xMotivo : ''}` };
  if (c && Number(c) >= 200) return { status_real: 'rejeitada', codigo_sefaz: c, mensagem: `NF rejeitada [SEFAZ ${c}]${xMotivo ? ' — ' + xMotivo : ''}` };
  if (numNf) return { status_real: 'emitida', numero_nf: String(numNf), codigo_sefaz: c || '100', mensagem: `NF ${numNf}` };
  return null;
}

// ConsultarNF (aceita nIdPedido) — usada quando etapa 60 mas o ConsultarPedido não trouxe nNF.
async function consultarNFporPedido(base44, codigoPedido) {
  const resp = await omieCall(base44, 'produtos/nfconsultar/', { nIdPedido: Number(codigoPedido) }, { call: 'ConsultarNF' });
  const ide = resp?.ide || {};
  const compl = resp?.compl || {};
  const numero = ide.nNF || resp?.cNumero || '';
  if (!numero) return null;
  return { numero_nf: String(numero), cStat: String(ide.cStat || compl.cStat || '100'), xMotivo: ide.xMotivo || compl.xMotivo || '' };
}

// Consulta etapa do pedido. Só resolve quando etapa >= 60 com NF real; etapa < 60 = aguardando (pendente).
async function consultarStatusReal(base44, codigoPedido) {
  let pedido;
  try {
    const r = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigoPedido) }, { call: 'ConsultarPedido' });
    pedido = r?.pedido_venda_produto || r || {};
  } catch (e) {
    if (e.bloqueio || e.redundante) throw e; // rate limit: deixa o chamador tratar como "ainda processando"
    return { erro: e.message };
  }

  const cab = pedido.cabecalho || {};
  const infoCad = pedido.infoCadastro || pedido.info_cadastro || {};
  const infoNfe = pedido.infoNfe || pedido.info_nf || pedido.informacoes_nfe || {};
  const etapa = String(cab.etapa || '');
  const etapaNum = Number(etapa) || 0;
  const nNF = infoNfe.nNF || infoNfe.numero_nf || cab.numero_nfe || cab.numero_nf || infoCad.nNumeroNFe || infoCad.numero_nfe || '';

  // Já tem dados de NF na resposta do ConsultarPedido?
  const classDireta = classificarNF(infoNfe.cStat || infoNfe.cStatus || '', nNF, infoNfe.xMotivo || infoNfe.cMensStatus || infoNfe.motivo || '');
  if (classDireta) return { etapa, ...classDireta };

  // Etapa 60 SEM cStat/nNF na resposta direta. IMPORTANTE: etapa 60 = pedido faturado/NF autorizada.
  // Tentamos enriquecer com ConsultarNF para pegar o número, mas se o rate limit atrapalhar,
  // NÃO marcamos erro nem deixamos pendente injustamente — etapa 60 já indica NF emitida.
  if (etapaNum >= 60) {
    try {
      await new Promise(r => setTimeout(r, 6000)); // delay anti-rajada antes da 2ª chamada
      const nfData = await consultarNFporPedido(base44, codigoPedido);
      if (nfData?.numero_nf) {
        const c = classificarNF(nfData.cStat, nfData.numero_nf, nfData.xMotivo) || { status_real: 'emitida', numero_nf: nfData.numero_nf, codigo_sefaz: nfData.cStat || '100', mensagem: `NF ${nfData.numero_nf} autorizada` };
        return { etapa, ...c };
      }
    } catch (e) {
      if (e.bloqueio || e.redundante) throw e; // rate limit no ConsultarNF → tratar como "verificando"
      console.warn(`[reconsultarStatusNFsPendentes] ConsultarNF falhou p/ ${codigoPedido}: ${e.message}`);
    }
    // Etapa 60 confirmada mas sem número de NF nesta consulta → autorizada (sem número ainda).
    // Resolve o número num refresh futuro; nunca vira erro.
    return { etapa, status_real: 'emitida', numero_nf: nNF || '', codigo_sefaz: '100', mensagem: nNF ? `NF ${nNF} autorizada` : 'NF autorizada (etapa 60)' };
  }

  // Etapa < 60 (ex: 50) → SEFAZ ainda processando → segue pendente (real).
  return { etapa, status_real: 'aguardando', mensagem: `Pedido em etapa ${etapa || '?'} — ainda processando` };
}

// Atualiza espelho PedidoLiberadoOmie
async function atualizarEspelho(base44, codigoPedido, real) {
  try {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1);
    const esp = espelhos?.[0];
    if (!esp) return;
    await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
      etapa: real.etapa || esp.etapa,
      status_real: real.status_real,
      status_label: real.mensagem,
      numero_nf: real.numero_nf || esp.numero_nf || '',
      sincronizado_em: new Date().toISOString(),
      origem_sync: 'reconciliacao'
    });
  } catch (e) { console.error('[reconsultarStatusNFsPendentes] espelho:', e.message); }
}

// Atualiza Pedido local quando NF confirmada
async function atualizarPedidoLocal(base44, codigoPedido, real) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1);
    const p = pedidos?.[0];
    if (!p) return;
    await base44.asServiceRole.entities.Pedido.update(p.id, {
      status: 'faturado', status_faturamento: 'faturado', faturado: true,
      ...(p.data_faturamento ? {} : { data_faturamento: new Date().toISOString() }),
      ...(real.numero_nf ? { numero_nota_fiscal: real.numero_nf } : {})
    });
  } catch (e) { console.error('[reconsultarStatusNFsPendentes] pedido local:', e.message); }
}

async function cancelarPedidoLocal(base44, codigoPedido, motivo, user) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) });
    const p = pedidos?.[0];
    if (!p) return;
    await base44.asServiceRole.entities.Pedido.update(p.id, {
      status: 'cancelado', motivo_cancelamento: motivo,
      cancelado_por: user.email, cancelado_por_nome: user.full_name || '', data_cancelamento: new Date().toISOString()
    });
  } catch (e) { console.error('[reconsultarStatusNFsPendentes] cancelar local:', e.message); }
}

async function deveGerarBoletoAuto(base44, codigoPedido) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) });
    const pedido = pedidos?.[0];
    if (!pedido?.cliente_id) return false;
    if (String(pedido.tipo || 'venda').toLowerCase() !== 'venda') return false;
    const cliente = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id);
    if (!cliente?.modalidade_pagamento_id) return false;
    const modalidade = await base44.asServiceRole.entities.ModalidadePagamento.get(cliente.modalidade_pagamento_id);
    return String(modalidade?.nome || '').toUpperCase().includes('BOLETO');
  } catch { return false; }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const codigos = [...new Set((Array.isArray(body?.codigos_pedido) ? body.codigos_pedido : []).map(String).filter(Boolean))];
    if (codigos.length === 0) {
      return Response.json({ sucesso: true, processados: 0, autorizados: 0, rejeitados: 0, ainda_pendentes: 0, resultados: [] });
    }

    // Teto de segurança por chamada. Consultas SEQUENCIAIS (1 por vez) com delay generoso
    // para nunca disparar em rajada (gatilho de "consumo redundante").
    const LIMITE = 4;
    const lote = codigos.slice(0, LIMITE);
    const DELAY_ENTRE = 9000; // ~9s entre ConsultarPedido (backoff suave aumenta isso)

    const breaker = await checkCircuitBreaker(base44);
    if (breaker.blocked) {
      return Response.json({ sucesso: false, abortado: true, motivo: 'circuit_breaker', bloqueado_ate: breaker.blockedUntil, resultados: [] });
    }

    const resultados = [];
    const codigosParaBoleto = [];

    for (let idx = 0; idx < lote.length; idx++) {
      const codPed = lote[idx];
      const codNum = Number(codPed);
      if (!Number.isFinite(codNum) || codNum <= 0) {
        resultados.push({ codigo_pedido: codPed, sucesso: false, mensagem: 'codigo_pedido inválido' });
        continue;
      }

      let real;
      try {
        real = await consultarStatusReal(base44, codPed);
      } catch (e) {
        // BLOQUEIO/circuit breaker OU REDUNDANTE/rate limit → PARAR o restante do lote (backoff).
        // Nenhum dos dois é erro de NF: mantém pendente e deixa pro próximo refresh.
        // Sem isso, continuar martelando o Omie só piora a rajada.
        const motivo = e.bloqueio ? 'bloqueio' : 'rate_limit';
        resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, abortado: true, motivo, mensagem: 'Verificando no Omie — aguarde um instante e atualize.' });
        break;
      }

      const logsDoPedido = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: String(codPed) }, '-created_date', 10).catch(() => []);

      // real.erro = falha REAL de consulta (estrutura, pedido inexistente) — NÃO é rejeição de NF
      // e NÃO é rate limit. Mantém pendente, não marca erro no log.
      if (real.erro) {
        resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, mensagem: real.erro });
        if (idx < lote.length - 1) await new Promise(r => setTimeout(r, DELAY_ENTRE));
        continue;
      }

      // Etapa < 60 / sem NF confirmada → segue PENDENTE (real). Não altera o log.
      if (real.status_real === 'aguardando') {
        resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, etapa: real.etapa, mensagem: real.mensagem });
        if (idx < lote.length - 1) await new Promise(r => setTimeout(r, DELAY_ENTRE));
        continue;
      }

      // Resposta final — atualiza espelho + pedido local + logs
      await atualizarEspelho(base44, codPed, real);

      let novoStatus;
      if (real.status_real === 'emitida') novoStatus = 'autorizada';
      else if (['rejeitada', 'cancelada', 'denegada'].includes(real.status_real)) novoStatus = 'rejeitada';
      else novoStatus = 'pendente';

      let deveBoleto = false;
      if (novoStatus === 'autorizada') {
        await atualizarPedidoLocal(base44, codPed, real);
        deveBoleto = await deveGerarBoletoAuto(base44, codPed);
        if (deveBoleto) codigosParaBoleto.push(codPed);
      }

      let primeiro = true;
      for (const l of logsDoPedido) {
        await base44.asServiceRole.entities.LogEmissaoNF.update(l.id, {
          status: novoStatus,
          numero_nf: real.numero_nf || l.numero_nf || '',
          mensagem: real.mensagem,
          codigo_sefaz: real.codigo_sefaz || (novoStatus === 'autorizada' ? '100' : ''),
          boleto_gerado: (primeiro && deveBoleto) ? true : (l.boleto_gerado || false)
        }).catch(() => {});
        primeiro = false;
      }

      if (real.status_real === 'denegada' || real.status_real === 'cancelada') {
        await cancelarPedidoLocal(base44, codPed, real.mensagem, user);
      }

      resultados.push({
        codigo_pedido: codPed, sucesso: true, novo_status: novoStatus,
        numero_nf: real.numero_nf || '', codigo_sefaz: real.codigo_sefaz || '', mensagem: real.mensagem
      });

      if (idx < lote.length - 1) await new Promise(r => setTimeout(r, DELAY_ENTRE));
    }

    // Boletos automáticos (não bloqueia a resposta da reconsulta)
    if (codigosParaBoleto.length > 0) {
      try {
        await base44.asServiceRole.functions.invoke('gerarBoletosOmie', {
          origem: 'auto', pedidos: codigosParaBoleto.map(codigo_pedido => ({ codigo_pedido }))
        });
      } catch (e) { console.error('[reconsultarStatusNFsPendentes] boletos:', e.message); }
    }

    return Response.json({
      sucesso: true,
      processados: resultados.length,
      autorizados: resultados.filter(r => r.novo_status === 'autorizada').length,
      rejeitados: resultados.filter(r => r.novo_status === 'rejeitada').length,
      ainda_pendentes: resultados.filter(r => r.ainda_pendente).length,
      boletos_disparados: codigosParaBoleto.length,
      resultados
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});