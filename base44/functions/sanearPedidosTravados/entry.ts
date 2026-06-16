import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// 🧹 SANEAMENTO SOB DEMANDA DE PEDIDOS TRAVADOS
// ─────────────────────────────────────────────────────────────────────────────
// Pedidos antigos podem ficar presos em etapas intermediárias no Omie (20 = liberado,
// 50 = em faturamento) sem nunca avançar — e a reconsulta repetida deles alimenta o
// rate limit. Esta função consulta CADA pedido informado UMA vez (sequencial, com
// delay generoso e respeitando o circuit breaker), reconcilia o espelho/pedido local
// e reporta a etapa real para o operador decidir.
//
// É SOB DEMANDA (botão "Sanear travados") — sem lock global, sem varredura.
// body: { codigos_pedido: [string] }  (recomendado: até 6 por chamada)

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
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

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
        if (res.status === 425 || res.status === 429 || msg.includes('redundante') || msg.includes('aguarde') || msg.includes('cota') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) {
          lastErr = data.faultstring;
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
          const e = new Error(data.faultstring); e.redundante = true; throw e;
        }
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

function rotuloEtapa(etapa) {
  const e = String(etapa || '');
  return ({ '10': 'Pendente', '20': 'Liberado', '50': 'Em faturamento', '60': 'Faturado', '70': 'Cancelado', '80': 'Cancelado' })[e] || `Etapa ${e || '?'}`;
}

// Atualiza espelho + pedido local com a etapa real consultada no Omie.
async function reconciliar(base44, codigoPedido, etapa, numeroNf) {
  const e = String(etapa || '');
  // Espelho
  try {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1);
    const esp = espelhos?.[0];
    if (esp) {
      await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
        etapa: e, sincronizado_em: new Date().toISOString(), origem_sync: 'reconciliacao',
        ...(numeroNf ? { numero_nf: String(numeroNf), status_real: 'emitida', status_label: 'Faturado' } : {})
      });
    }
  } catch {}
  // Pedido local
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1);
    const p = pedidos?.[0];
    if (p) {
      const updates = {};
      if (e === '60') {
        updates.status = 'faturado'; updates.status_faturamento = 'faturado'; updates.faturado = true;
        if (!p.data_faturamento) updates.data_faturamento = new Date().toISOString();
        if (numeroNf) updates.numero_nota_fiscal = String(numeroNf);
      } else if (e === '20') {
        if (p.status === 'pendente' || p.status === 'enviado') updates.status = 'liberado';
      } else if (e === '50') {
        if (p.status !== 'montagem') updates.status = 'montagem';
      }
      if (Object.keys(updates).length > 0) await base44.asServiceRole.entities.Pedido.update(p.id, updates);
    }
  } catch {}
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const codigos = [...new Set((Array.isArray(body?.codigos_pedido) ? body.codigos_pedido : []).map(String).filter(Boolean))];
    if (codigos.length === 0) {
      return Response.json({ sucesso: true, processados: 0, resultados: [] });
    }

    const breaker = await checkCircuitBreaker(base44);
    if (breaker.blocked) {
      return Response.json({ sucesso: false, abortado: true, motivo: 'circuit_breaker', bloqueado_ate: breaker.blockedUntil, resultados: [] });
    }

    const LIMITE = 6;
    const lote = codigos.slice(0, LIMITE);
    const DELAY_ENTRE = 8000; // 8s entre consultas — saneamento é sob demanda, pode ser lento

    // Resolve cada entrada para o nCodPed real do Omie. O operador pode informar o NÚMERO do
    // pedido (ex: 453) — buscamos o codigo_pedido (nCodPed) correspondente no espelho local.
    async function resolverNCodPed(valor) {
      // 1) Já é um nCodPed (existe no espelho como codigo_pedido)?
      const porCodigo = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(valor) }, '-sincronizado_em', 1).catch(() => []);
      if (porCodigo?.[0]) return String(valor);
      // 2) É um número de pedido? Resolve para o nCodPed.
      const porNumero = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ numero_pedido: String(valor) }, '-sincronizado_em', 1).catch(() => []);
      if (porNumero?.[0]?.codigo_pedido) return String(porNumero[0].codigo_pedido);
      // 3) Tenta no Pedido local.
      const ped = await base44.asServiceRole.entities.Pedido.filter({ numero_pedido: String(valor) }, '-created_date', 1).catch(() => []);
      if (ped?.[0]?.omie_codigo_pedido) return String(ped[0].omie_codigo_pedido);
      return String(valor); // fallback: usa como veio
    }

    const resultados = [];
    for (let idx = 0; idx < lote.length; idx++) {
      const entrada = lote[idx];
      const codPed = await resolverNCodPed(entrada);
      const codNum = Number(codPed);
      if (!Number.isFinite(codNum) || codNum <= 0) {
        resultados.push({ codigo_pedido: entrada, sucesso: false, mensagem: 'código inválido / não encontrado' });
        continue;
      }

      try {
        const r = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: codNum }, { call: 'ConsultarPedido' });
        const pedido = r?.pedido_venda_produto || {};
        const cab = pedido.cabecalho || {};
        const infoNfe = pedido.infoNfe || pedido.info_nf || {};
        const etapa = String(cab.etapa || '');
        const numeroNf = infoNfe?.nNF || cab?.numero_nfe || '';

        await reconciliar(base44, codPed, etapa, numeroNf);

        let acao;
        if (etapa === '60') acao = 'avancou_para_NF';
        else if (etapa === '20' || etapa === '50') acao = 'ainda_travado';
        else if (etapa === '70' || etapa === '80') acao = 'cancelado_no_omie';
        else acao = 'verificado';

        resultados.push({
          codigo_pedido: codPed, numero_pedido: String(entrada), sucesso: true, etapa, etapa_label: rotuloEtapa(etapa),
          numero_nf: numeroNf ? String(numeroNf) : '', acao,
          mensagem: etapa === '60'
            ? `Faturado${numeroNf ? ' — NF ' + numeroNf : ''} (espelho/pedido atualizados)`
            : `Continua em ${rotuloEtapa(etapa)} no Omie — requer ação manual`
        });
      } catch (e) {
        if (e.bloqueio || e.redundante) {
          resultados.push({ codigo_pedido: codPed, numero_pedido: String(entrada), sucesso: false, abortado: true, motivo: e.bloqueio ? 'bloqueio' : 'rate_limit', mensagem: 'Omie pediu para aguardar — tente novamente em ~1 min.' });
          break;
        }
        resultados.push({ codigo_pedido: codPed, numero_pedido: String(entrada), sucesso: false, mensagem: e.message });
      }

      if (idx < lote.length - 1) await new Promise(r => setTimeout(r, DELAY_ENTRE));
    }

    return Response.json({
      sucesso: true,
      processados: resultados.filter(r => r.sucesso).length,
      avancaram: resultados.filter(r => r.acao === 'avancou_para_NF').length,
      ainda_travados: resultados.filter(r => r.acao === 'ainda_travado').length,
      resultados
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});