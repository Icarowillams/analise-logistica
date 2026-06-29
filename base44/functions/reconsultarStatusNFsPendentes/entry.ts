import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 🔎 RECONSULTA SOB DEMANDA — resolve o status real de NFs "pendentes"/"erro" consultando o Omie AO VIVO.
//
// 100% POR AÇÃO HUMANA — ZERO AUTOMAÇÃO. Nenhum schedule chama esta função; ela só roda quando o
// operador abre a aba (reconsulta) ou clica em "Confirmar/Reprocessar pendentes" (reprocessar=true).
// O FRONTEND orquestra os lotes (poucos códigos por vez) para não estourar o teto de 180s e atualizar
// a UI conforme cada lote chega. Sem lock/debounce/cooldown global; processa só os codigos_pedido recebidos.
//
// Consulta o Omie AO VIVO (ConsultarPedido) ANTES de qualquer decisão:
//   - etapa 60 / NF presente → grava 'autorizada' (só leitura).
//   - etapa 50 com autorização em curso → segue 'pendente' (aguardando SEFAZ), só reconsulta.
//   - etapa 50 PRESO de verdade + reprocessar=true → reaciona a emissão (após confirmar não-faturado).
//   - recusa real do Omie (cCodStatus≠100, ex: cliente bloqueado) → 'erro' com o motivo real.
//   - rejeitada/denegada/cancelada → 'rejeitada'.
//
// body: { codigos_pedido: [string], reprocessar?: boolean }  (recomendado: até 4 por chamada)

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

let _credsCache = null;
async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = Deno.env.get('OMIE_APP_KEY') || cfg?.app_key || '';
  const appSecret = Deno.env.get('OMIE_APP_SECRET') || cfg?.app_secret || '';
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
  // 135 = evento de AUTORIZAÇÃO confirmado → autorizada. Só 101 = cancelamento homologado.
  if (c === '100' || c === '150' || c === '135') return { status_real: 'emitida', numero_nf: String(numNf || ''), codigo_sefaz: c, mensagem: `NF ${numNf} autorizada` };
  if (c === '101') return { status_real: 'cancelada', numero_nf: String(numNf || ''), codigo_sefaz: c, mensagem: `NF ${numNf} cancelada${xMotivo ? ' — ' + xMotivo : ''}` };
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
  // ATALHO RÁPIDO: tenta ConsultarNF direto pelo pedido ANTES do ConsultarPedido.
  // Se a NF já existe no Omie, resolve "autorizada" em 1 única chamada — sem depender da
  // etapa do pedido (que demora a virar 60) e sem a 2ª chamada/delay. Elimina o delay no caso comum.
  try {
    const nfData = await consultarNFporPedido(base44, codigoPedido);
    if (nfData?.numero_nf) {
      const c = classificarNF(nfData.cStat, nfData.numero_nf, nfData.xMotivo)
        || { status_real: 'emitida', numero_nf: nfData.numero_nf, codigo_sefaz: nfData.cStat || '100', mensagem: `NF ${nfData.numero_nf} autorizada` };
      return { etapa: '60', ...c };
    }
  } catch (e) {
    if (e.bloqueio || e.redundante) throw e; // rate limit → chamador trata como "verificando"
    // Sem NF ainda (ou erro de "NF não encontrada") → segue pro ConsultarPedido normal abaixo.
  }

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
  // O ConsultarNF já foi tentado no atalho rápido no topo desta função; se não trouxe número,
  // ainda assim etapa 60 indica NF emitida — autorizada (sem número ainda, resolve num refresh futuro).
  if (etapaNum >= 60) {
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
    // reprocessar=true → o operador clicou em "Confirmar/Reprocessar pendentes": além de
    // reconsultar ao vivo, reaciona a emissão dos que estão PRESOS de verdade na etapa 50.
    // Sem isso (reconsulta normal / abertura da aba), só lê o status, nunca reemite.
    const reprocessar = body?.reprocessar === true;
    if (codigos.length === 0) {
      return Response.json({ sucesso: true, processados: 0, autorizados: 0, rejeitados: 0, ainda_pendentes: 0, resultados: [] });
    }

    // Teto de segurança por chamada. Consultas SEQUENCIAIS (1 por vez) com delay generoso
    // para nunca disparar em rajada (gatilho de "consumo redundante").
    const LIMITE = 4;
    const lote = codigos.slice(0, LIMITE);
    const DELAY_ENTRE = 4000; // ~4s entre pedidos (agora 1 chamada/pedido via atalho ConsultarNF)

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

      // Etapa < 60 / sem NF confirmada → SEFAZ ainda processando, OU pedido preso de verdade.
      // AÇÃO HUMANA APENAS — nada de reacionamento por schedule. Aqui, com `reprocessar=true`
      // (botão "Confirmar/Reprocessar pendentes"), distinguimos:
      //   • etapa 50 com NF saindo (autorização assíncrona em curso) → segue pendente, só reconsulta.
      //   • etapa 50 PRESO de verdade (faturado=N há mais de 10min) → reaciona a emissão por clique,
      //     mas SOMENTE após confirmar que NÃO está faturado. emitirNfPedidoOmie tem blindagem
      //     anti-duplicidade adicional. Recusa real do Omie (cCodStatus≠100) vira erro com motivo real.
      //   • sem reprocessar → mantém honesto: "aguardando SEFAZ".
      if (real.status_real === 'aguardando') {
        const etapaNum = Number(real.etapa) || 0;
        let msgPend = etapaNum === 50
          ? 'Faturado na carga — aguardando autorização da SEFAZ (etapa 50).'
          : (real.mensagem || 'Aguardando SEFAZ');
        let novoStatusLog = 'pendente';

        // Detecta "preso": o log pendente mais antigo deste pedido tem mais de 10 minutos.
        const PRESO_MS = 10 * 60 * 1000;
        const maisAntigo = logsDoPedido.reduce((min, l) => {
          const t = new Date(l.created_date || l.updated_date || Date.now()).getTime();
          return t < min ? t : min;
        }, Date.now());
        const estaPreso = etapaNum === 50 && (Date.now() - maisAntigo) > PRESO_MS;

        // Só reaciona a emissão quando o operador clicou em REPROCESSAR e o pedido está preso.
        // NUNCA reemite sem antes confirmar que o pedido não está faturado (já confirmado acima:
        // real.status_real === 'aguardando' significa etapa < 60, faturado=N no Omie).
        let reacionado = false;
        if (reprocessar && estaPreso) {
          try {
            const respEmit = await base44.asServiceRole.functions.invoke('emitirNfPedidoOmie', { codigo_pedido: String(codPed) });
            const re = respEmit?.data || {};
            const cCod = String(re?.cCodStatus || re?.resposta?.cCodStatus || '');
            const cDesc = re?.cDescStatus || re?.resposta?.cDescStatus || '';
            reacionado = true;
            if (re.numero_nf || /já foi faturado/i.test(re.error || '')) {
              msgPend = re.error || 'Pedido já faturado — atualizando status.';
            } else if (cCod && cCod !== '100' && cCod !== '0') {
              // Recusa REAL do Omie (cliente bloqueado, sem cenário fiscal, etc.) — não emite sozinho.
              msgPend = `Não emite: ${cDesc || 'recusado pelo Omie'}`;
              novoStatusLog = 'erro';
            } else if (re.sucesso) {
              msgPend = 'Emissão reprocessada (estava presa na etapa 50) — aguardando a SEFAZ.';
            } else {
              msgPend = 'Reprocessamento não concluiu: ' + (re.error || 'erro Omie') + '. Tente novamente.';
            }
          } catch (emitErr) {
            // Bloqueio/rate limit na reemissão → não é erro do pedido; o operador tenta de novo.
            msgPend = 'Omie ocupado no momento — tente reprocessar novamente em ~1 min.';
          }
        }

        for (const l of logsDoPedido) {
          await base44.asServiceRole.entities.LogEmissaoNF.update(l.id, {
            status: novoStatusLog,
            mensagem: msgPend
          }).catch(() => {});
        }
        resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: novoStatusLog === 'pendente', etapa: real.etapa, reacionado, mensagem: msgPend });
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
        // 🛡️ BLINDAGEM FISCAL: NF já autorizada (com número + chave) só é rebaixada com cStat 101
        // EXPLÍCITO. Qualquer leitura ambígua é ignorada para não corromper o registro fiscal.
        const jaAutorizada = l.status === 'autorizada' && l.numero_nf && l.chave_nfe;
        const cancelamentoComprovado = real.status_real === 'cancelada' && String(real.codigo_sefaz) === '101';
        if (jaAutorizada && novoStatus !== 'autorizada' && !cancelamentoComprovado) {
          console.warn(`[reconsultarStatusNFsPendentes] IGNORADO rebaixamento da NF ${l.numero_nf} (pedido ${codPed}): leitura "${real.status_real}" não rebaixa NF autorizada.`);
          primeiro = false;
          continue;
        }
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

    // Boletos: ENFILEIRA em FilaBoletoOmie (worker espaçado de baixa prioridade) em vez de
    // gerar inline — evita rajada de boletos que estoura o rate limit global.
    for (const codigo_pedido of codigosParaBoleto) {
      try {
        const jaNaFila = await base44.asServiceRole.entities.FilaBoletoOmie.filter({ codigo_pedido: String(codigo_pedido) }, '-created_date', 1).catch(() => []);
        const naoFinalizado = jaNaFila?.[0] && ['pendente', 'processando'].includes(jaNaFila[0].status);
        if (!naoFinalizado) {
          await base44.asServiceRole.entities.FilaBoletoOmie.create({ codigo_pedido: String(codigo_pedido), origem: 'reconsulta', status: 'pendente', tentativas: 0 }).catch(() => {});
        }
      } catch (e) { console.error('[reconsultarStatusNFsPendentes] enfileirar boleto:', e.message); }
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