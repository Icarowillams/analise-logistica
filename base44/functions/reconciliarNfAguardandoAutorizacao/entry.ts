import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';
let _credsCache = null;

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30000) return _credsCache;
  // FONTE DE VERDADE = Secrets do backend (o app_secret não fica mais no banco).
  const appSecret = Deno.env.get('OMIE_APP_SECRET') || '';
  let appKey = Deno.env.get('OMIE_APP_KEY') || '';
  if (!appKey) {
    const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    appKey = rows?.[0]?.app_key || '';
  }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

function extrairSegundosBloqueio(msg) {
  const match = String(msg).match(/(\d+)\s*segundo/i);
  return match ? Math.min(Number(match[1]), 1800) : 0;
}

async function abrirCircuitBreaker(base44, msg) {
  const secs = extrairSegundosBloqueio(msg);
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const cb = rows?.[0];
  const erros = (cb?.erros_consecutivos || 0) + 1;
  const thresh = cb?.threshold_erros ?? 3;
  const p = { erros_consecutivos: erros, ultimo_erro: String(msg).slice(0, 500), atualizado_em: new Date().toISOString() };
  if (erros >= thresh && secs > 0) { p.bloqueado = true; p.bloqueado_ate = new Date(Date.now() + secs * 1000).toISOString(); }
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, p).catch(() => null);
}

async function omieCall(base44, endpoint, param, call) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  const url = OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
  } finally { clearTimeout(tid); }
  // Tratamento de status HTTP ANTES de res.json() (5xx/429/425 podem não ser JSON)
  if (res.status === 425 || res.status === 429 || res.status >= 500) {
    const corpo = await res.text().catch(() => '');
    const erro = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
    if (res.status === 425) { await abrirCircuitBreaker(base44, erro); const e = new Error(erro); e.code = 'OMIE_425'; throw e; }
    const e = new Error(erro); e.transitorio = true; throw e;
  }
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
      await abrirCircuitBreaker(base44, data.faultstring); const e = new Error(data.faultstring); e.code = 'OMIE_425'; throw e;
    }
    if (msg.includes('redundante') || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite')) {
      const e = new Error(data.faultstring); e.transitorio = true; throw e;
    }
    // Pedido não encontrado / não cadastrado → terminal (não dá retry)
    if (msg.includes('não cadastrad') || msg.includes('nao cadastrad') || msg.includes('não existem registros') || msg.includes('nao existem registros')) {
      const e = new Error(data.faultstring); e.terminal = true; throw e;
    }
    throw new Error(data.faultstring);
  }
  return data;
}
// ═══ fim omieClient inline ═══

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtData(d) {
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
}

// Constrói um mapa código_pedido(nIdPedido) → { nNF, cChave } varrendo as NFs dos últimos 15 dias
// via ListarNF (que NÃO aceita filtro por pedido — cruzamos pelo compl.nIdPedido de cada NF).
// Uma única varredura por execução, reaproveitada para todos os pedidos do lote.
// PARA CEDO assim que encontra todos os códigos do lote (alvos) — economiza chamadas e evita o 425.
async function construirMapaNfsRecentes(base44, alvos) {
  const mapa = new Map();
  const restantes = new Set(alvos);
  if (restantes.size === 0) return mapa;
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - 15 * 24 * 60 * 60 * 1000);
  const dEmiInicial = fmtData(inicio);
  const dEmiFinal = fmtData(hoje);
  let pg = 1, totalPaginas = 1;
  const MAX_PAGINAS = 30;
  do {
    const d = await omieCall(base44, 'produtos/nfconsultar/', {
      pagina: pg, registros_por_pagina: 100, dEmiInicial, dEmiFinal
    }, 'ListarNF');
    totalPaginas = d.nTotPaginas || d.total_de_paginas || 1;
    (d.nfCadastro || []).forEach((nf) => {
      const idPed = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
      const nNF = nf.ide?.nNF || nf.cNumero || '';
      const cChave = nf.compl?.cChaveNFe || nf.cChaveNFe || '';
      if (idPed && nNF && restantes.has(idPed)) {
        mapa.set(idPed, { nNF: String(nNF), cChave: String(cChave || '') });
        restantes.delete(idPed);
      }
    });
    if (restantes.size === 0) break; // achou todas as NFs do lote
    pg++;
    await sleep(400);
  } while (pg <= totalPaginas && pg <= MAX_PAGINAS);
  return mapa;
}

// CAMADA 3 — REDE DE SEGURANÇA (não fluxo principal).
// Processa SOMENTE pedidos nf_aguardando_autorizacao=true, em lotes pequenos com pausa.
// Lê a etapa real via ConsultarPedido: 60 = puxa nNF e grava; 50 = ainda processando (mantém flag).
// NUNCA refatura. Para tudo no circuit breaker (425). Não dispara em rajada.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    // Admin-only (chamada manual) OU automação agendada (sem user → service role já valida pelo token).
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Apenas administradores' }, { status: 403 });
    }

    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) {
      return Response.json({ sucesso: false, motivo: 'circuit_breaker_ativo', bloqueado_ate: cb.blockedUntil, processados: 0 });
    }

    const body = await req.json().catch(() => ({}));
    const LIMITE = Math.min(body.limite || 15, 30); // lote pequeno por execução

    const aguardando = await base44.asServiceRole.entities.Pedido.filter(
      { nf_aguardando_autorizacao: true }, '-data_faturamento', LIMITE
    ).catch(() => []);

    if (aguardando.length === 0) {
      return Response.json({ sucesso: true, mensagem: 'Nenhum pedido aguardando autorização de NF', processados: 0 });
    }

    let preenchidos = 0, aindaAguardando = 0, semCodigo = 0, terminais = 0;
    const resultados = [];

    // Mapa nIdPedido(código do pedido Omie) → { nNF, cChave } construído UMA vez via ListarNF
    // por faixa de datas. O ListarNF NÃO aceita filtro por pedido — cada NF traz compl.nIdPedido,
    // então varremos a janela recente e cruzamos localmente (mesmo padrão do listarNfsOmie).
    // Só busca os códigos do lote (para cedo quando acha todos) → economiza chamadas/evita 425.
    const alvosCodigos = aguardando.map(p => String(p.omie_codigo_pedido || '')).filter(Boolean);
    const mapaNfPorPedido = await construirMapaNfsRecentes(base44, alvosCodigos).catch(() => new Map());

    for (const pedido of aguardando) {
      if (!pedido.omie_codigo_pedido) {
        // Sem código Omie → não há como consultar. Limpa a flag para não ficar preso.
        await base44.asServiceRole.entities.Pedido.update(pedido.id, { nf_aguardando_autorizacao: false }).catch(() => {});
        semCodigo++;
        continue;
      }

      try {
        const data = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(pedido.omie_codigo_pedido) }, 'ConsultarPedido');
        const pv = data?.pedido_venda_produto || {};
        const cab = pv.cabecalho;
        const infoCad = pv.infoCadastro || pv.info_cadastro || {};
        const etapa = String(cab?.etapa || '');
        const faturado = String(infoCad.faturado || '').toUpperCase() === 'S';
        const autorizado = String(infoCad.autorizado || '').toUpperCase() === 'S';
        const infoNfe = pv.infoNfe || pv.info_nf || null;
        let nNF = infoNfe?.nNF || infoNfe?.numero_nf || cab?.numero_nfe || null;
        let cChave = infoNfe?.cChaveNFe || infoNfe?.chave_nfe || null;

        // FATURADO de verdade: etapa 60 + faturado=S no Omie. O ConsultarPedido NÃO traz o número
        // da NF — busca via ListarNF por código de pedido. Mas mesmo sem o número, o pedido JÁ está
        // faturado → marca como faturado e destrava a flag (o número é cosmético, vem depois).
        if (etapa === '60' && (faturado || autorizado)) {
          if (!nNF) {
            // Cruza pelo código do pedido no mapa de NFs recentes (ListarNF por data).
            const achada = mapaNfPorPedido.get(String(pedido.omie_codigo_pedido));
            if (achada) {
              nNF = achada.nNF || nNF;
              cChave = achada.cChave || cChave;
            }
          }
          const upd = {
            faturado: true,
            status: 'faturado',
            status_faturamento: 'faturado',
            data_faturamento: pedido.data_faturamento || new Date().toISOString(),
            nf_aguardando_autorizacao: false,
            pendente_emissao: false
          };
          if (nNF) upd.numero_nota_fiscal = String(nNF).padStart(6, '0');
          if (cChave) upd.chave_nfe = String(cChave);
          await base44.asServiceRole.entities.Pedido.update(pedido.id, upd);
          // Atualiza também o log de emissão para "autorizada" (deixa de ficar "pendente").
          try {
            const logs = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: String(pedido.omie_codigo_pedido) }, '-created_date', 5).catch(() => []);
            const log = logs?.[0];
            if (log && log.status !== 'autorizada') {
              await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, {
                status: 'autorizada', codigo_sefaz: '100',
                numero_nf: upd.numero_nota_fiscal || log.numero_nf || '',
                chave_nfe: upd.chave_nfe || log.chave_nfe || '',
                mensagem: `NF confirmada no Omie (etapa 60, faturado)${upd.numero_nota_fiscal ? ` — nº ${upd.numero_nota_fiscal}` : ''}.`
              }).catch(() => {});
            }
          } catch { /* ignore */ }
          preenchidos++;
          resultados.push({ pedido: pedido.numero_pedido, numero_nf: upd.numero_nota_fiscal || '(faturado, nº pendente)' });
        } else {
          // Etapa 50 — SEFAZ não autorizou ainda. Mantém a flag.
          aindaAguardando++;
        }
      } catch (e) {
        if (e.code === 'OMIE_425') {
          // Bloqueio → para tudo imediatamente. Os pedidos restantes ficam com a flag para o próximo ciclo.
          return Response.json({
            sucesso: false, motivo: 'circuit_breaker_425', mensagem: e.message,
            preenchidos, ainda_aguardando: aindaAguardando, sem_codigo: semCodigo, terminais
          });
        }
        if (e.terminal) {
          // Pedido não existe mais no Omie — limpa flag (não reprocessar).
          await base44.asServiceRole.entities.Pedido.update(pedido.id, { nf_aguardando_autorizacao: false }).catch(() => {});
          terminais++;
        } else {
          // Transitório — deixa a flag para o próximo ciclo.
          aindaAguardando++;
        }
      }

      await sleep(600); // pausa entre pedidos — respeita o rate limit (nunca rajada)
    }

    return Response.json({
      sucesso: true,
      total: aguardando.length,
      preenchidos,
      ainda_aguardando: aindaAguardando,
      sem_codigo: semCodigo,
      terminais,
      resultados
    });
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada }, { status: bloqueada ? 425 : 500 });
  }
});