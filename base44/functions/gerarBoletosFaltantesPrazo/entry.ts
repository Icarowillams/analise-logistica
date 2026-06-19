// Gera boletos FALTANTES apenas para pedidos A PRAZO com NF autorizada e sem boleto.
// Regra: boleto só a prazo — /vista/i no plano = à vista, NÃO gera.
// Antes de gerar, consulta o Omie: alguns títulos podem JÁ ter boleto (log defasado) →
// nesse caso só atualiza o flag boleto_gerado, não gera de novo.
// Sequencial, em levas pequenas com delay, com backoff no rate-limit (425/429).
// Lógica de Omie inlinada (não invoca outra função) para evitar saltos service-to-service.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline ═══
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

const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

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
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      // Trata 5xx/429/425 via res.text() ANTES do parse (corpo pode não ser JSON).
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        // "Consumo redundante" → re-tentável, mas o Omie pede ~50s. Espera o que ele indica (teto 12s/tentativa)
        // para não estourar o tempo de execução; se ainda bloquear, lança e a leva para (re-tenta depois).
        if (/redundante|redundant/i.test(corpo)) {
          if (i < RETRIES.length) {
            const m = corpo.match(/(\d+)\s*segundos?/i);
            const espera = Math.min((m ? Number(m[1]) : 8) * 1000, 12000);
            await new Promise(r => setTimeout(r, espera)); continue;
          }
          throw new Error(lastErr);
        }
        if (res.status === 425) {
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          throw new Error(data.faultstring);
        }
        if (msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) {
          lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        }
        throw new Error(data.faultstring);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
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

const ehAVista = (nome) => /vista/i.test(String(nome || ''));
const isRateLimit = (msg) => {
  const m = String(msg || '').toLowerCase();
  return m.includes('425') || m.includes('429') || m.includes('consumo indevido') ||
         m.includes('redundante') || m.includes('redundant') ||
         m.includes('bloqueada') || m.includes('bloqueio') || m.includes('cota') || m.includes('aguarde');
};
// Lista TODAS as contas a receber de um cliente (por codigo_cliente_fornecedor), com paginação.
// SEM janela de data estreita — o casamento robusto é feito depois por nCodPedido em memória.
async function listarTitulosDoCliente(base44, codigoClienteOmie) {
  const codCli = Number(codigoClienteOmie);
  if (!codCli) return [];
  let acumulados = [];
  // Teto de 3 páginas (antes 10): o casamento é por nCodPedido e títulos muito antigos não interessam.
  // Menos páginas = menos chamadas ListarContasReceber por pedido (maior ofensor do rate limit).
  for (let pag = 1; pag <= 3; pag++) {
    const data = await omieCall(base44, 'financas/contareceber/', {
      pagina: pag, registros_por_pagina: 100, apenas_importado_api: 'N',
      codigo_cliente_fornecedor: codCli
    }, { call: 'ListarContasReceber' });
    acumulados.push(...(data?.conta_receber_cadastro || []));
    if (pag >= (data?.total_de_paginas || 1)) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  return acumulados;
}

// Casa os títulos do cliente com o pedido por nCodPedido (primário) ou NF (secundário).
function casarTitulosComPedido(titulos, pedido) {
  const codPed = String(pedido.omie_codigo_pedido || '').replace(/\D/g, '');
  const numNf = pedido.numero_nota_fiscal ? String(pedido.numero_nota_fiscal).replace(/\D/g, '') : null;
  let casados = titulos.filter((t) => {
    const tp = String(t.nCodPedido ?? t.codigo_pedido ?? '').replace(/\D/g, '');
    return tp && codPed && tp === codPed;
  });
  if (casados.length === 0 && numNf) {
    casados = titulos.filter((t) => {
      const nf = String(t.numero_documento_fiscal ?? t.numero_documento ?? '').replace(/\D/g, '');
      return nf && nf === numNf;
    });
  }
  return casados;
}

// Gera o boleto de um título (já casado e SEM boleto). Backoff no rate-limit.
async function gerarBoletoTitulo(base44, titulo) {
  const codigo = titulo.codigo_lancamento_omie || titulo.codigo_lancamento;
  let tent = 0;
  while (true) {
    try {
      const data = await omieCall(base44, 'financas/contareceberboleto/', { nCodTitulo: Number(codigo) }, { call: 'GerarBoleto' });
      const codStatus = String(data.cCodStatus || '0');
      if (codStatus !== '0' && codStatus !== '') return { falha: true, mensagem: data.cDesStatus || `status ${codStatus}` };
      const sucessoReal = !!(String(data.cNumBoleto || '').trim() || String(data.cCodBarras || '').trim() || String(data.cLinkBoleto || '').trim());
      return sucessoReal ? { gerado: true } : { falha: true, mensagem: 'Omie sem dados de boleto' };
    } catch (e) {
      const msg = String(e.message || '').toLowerCase();
      if (/já gerado|ja gerado|já existe|ja existe/.test(msg)) return { jaTinha: true };
      if (/liquidado|baixado|cancelado/.test(msg)) return { skip: true, motivo: msg };
      if (isRateLimit(e.message) && tent < 3) { tent++; await new Promise(r => setTimeout(r, 5000 * tent)); continue; }
      return { falha: true, mensagem: e.message };
    }
  }
}

// Flag cGerado do próprio título: 'S' = já tem boleto.
const boletoJaGerado = (t) => String(t?.boleto?.cGerado || t?.cGerado || '').toUpperCase() === 'S';
const tituloCancelado = (t) => String(t?.status_titulo || '').toUpperCase() === 'CANCELADO';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const maxPedidos = Math.max(1, Math.min(Number(body.max_pedidos || 5), 10));
    const skip = Math.max(0, Number(body.skip || 0));

    // 1) Logs de NF autorizada SEM boleto.
    const logsAutorizados = await base44.asServiceRole.entities.LogEmissaoNF.filter(
      { status: 'autorizada' }, '-created_date', 2000
    );
    const semBoletoLog = logsAutorizados.filter(l => l.boleto_gerado !== true && l.codigo_pedido);

    // 2) Cruza com Pedido (em lote via $in) para obter plano e descartar À VISTA.
    const codigos = [...new Set(semBoletoLog.map(l => String(l.codigo_pedido)).filter(Boolean))];
    const pedidoPorCodigo = new Map();
    const LOTE = 100;
    for (let i = 0; i < codigos.length; i += LOTE) {
      const fatia = codigos.slice(i, i + LOTE);
      const peds = await base44.asServiceRole.entities.Pedido.filter(
        { omie_codigo_pedido: { $in: fatia } }, '-created_date', 500
      );
      for (const p of peds) {
        const k = String(p.omie_codigo_pedido);
        if (!pedidoPorCodigo.has(k)) pedidoPorCodigo.set(k, p);
      }
    }

    const candidatos = [];
    for (const log of semBoletoLog) {
      const ped = pedidoPorCodigo.get(String(log.codigo_pedido));
      if (!ped) continue; // sem pedido local não confirma plano → pula (não gera à vista por engano)
      if (ehAVista(ped.plano_pagamento_nome)) continue;
      candidatos.push({ log, pedido: ped });
    }

    const totalCandidatos = candidatos.length;
    const lote = candidatos.slice(skip, skip + maxPedidos);

    // Resolve o código do cliente Omie de cada pedido da leva (via Cliente).
    const clienteIds = [...new Set(lote.map(c => c.pedido.cliente_id).filter(Boolean))];
    const codClientePorClienteId = new Map();
    for (let i = 0; i < clienteIds.length; i += 100) {
      const fatia = clienteIds.slice(i, i + 100);
      const clis = await base44.asServiceRole.entities.Cliente.filter({ id: { $in: fatia } }, '-created_date', 200).catch(() => []);
      for (const c of clis) {
        const cod = c.codigo_cliente_omie || c.codigo_omie;
        if (cod) codClientePorClienteId.set(c.id, cod);
      }
    }

    let gerados = 0, jaTinham = 0, semTitulo = 0, falhas = 0;
    const detalhes = [];

    for (const { log, pedido } of lote) {
      try {
        const codCli = codClientePorClienteId.get(pedido.cliente_id);
        if (!codCli) {
          semTitulo++;
          detalhes.push({ codigo_pedido: log.codigo_pedido, status: 'sem_titulo', mensagem: 'cliente sem código Omie' });
          await new Promise(r => setTimeout(r, 2500));
          continue;
        }

        const todosTitulos = await listarTitulosDoCliente(base44, codCli);
        const casados = casarTitulosComPedido(todosTitulos, pedido);

        if (casados.length === 0) {
          semTitulo++;
          detalhes.push({ codigo_pedido: log.codigo_pedido, status: 'sem_titulo' });
        } else {
          // Dedup por código de lançamento.
          const vistos = new Set();
          const unicos = casados.filter(t => {
            const c = String(t.codigo_lancamento_omie || t.codigo_lancamento || '');
            if (!c || vistos.has(c)) return false;
            vistos.add(c); return true;
          });

          // Já tem boleto em TODOS os títulos não-cancelados? → só marca o log.
          const naoCancelados = unicos.filter(t => !tituloCancelado(t));
          const aGerar = naoCancelados.filter(t => !boletoJaGerado(t));

          if (naoCancelados.length > 0 && aGerar.length === 0) {
            jaTinham++;
            await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, { boleto_gerado: true }).catch(() => {});
            detalhes.push({ codigo_pedido: log.codigo_pedido, status: 'ja_tinha' });
          } else if (aGerar.length === 0) {
            // só cancelados
            semTitulo++;
            detalhes.push({ codigo_pedido: log.codigo_pedido, status: 'sem_titulo', mensagem: 'apenas cancelados' });
          } else {
            let algumGerado = false, algumJaTinha = false, algumaFalha = false;
            for (let i = 0; i < aGerar.length; i++) {
              const r = await gerarBoletoTitulo(base44, aGerar[i]);
              if (r.gerado) algumGerado = true;
              else if (r.jaTinha) algumJaTinha = true;
              else if (r.falha) algumaFalha = true;
              if (i < aGerar.length - 1) await new Promise(r => setTimeout(r, 1200));
            }

            if (algumGerado) {
              gerados++;
              await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, { boleto_gerado: true }).catch(() => {});
              detalhes.push({ codigo_pedido: log.codigo_pedido, status: 'gerado' });
            } else if (algumJaTinha) {
              jaTinham++;
              await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, { boleto_gerado: true }).catch(() => {});
              detalhes.push({ codigo_pedido: log.codigo_pedido, status: 'ja_tinha' });
            } else if (algumaFalha) {
              falhas++;
              detalhes.push({ codigo_pedido: log.codigo_pedido, status: 'falha' });
            }
          }
        }
      } catch (e) {
        falhas++;
        detalhes.push({ codigo_pedido: log.codigo_pedido, status: 'falha', mensagem: e.message });
        // Se a API bloqueou, para a leva — front re-tenta do mesmo skip depois.
        if (isRateLimit(e.message)) break;
      }
      await new Promise(r => setTimeout(r, 2500));
    }

    const proximoSkip = skip + lote.length;
    const concluida = proximoSkip >= totalCandidatos;

    return Response.json({
      sucesso: true,
      total_candidatos: totalCandidatos,
      processados_nesta_leva: lote.length,
      gerados, ja_tinham: jaTinham, sem_titulo: semTitulo, falhas,
      proximo_skip: proximoSkip,
      concluida,
      detalhes
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});