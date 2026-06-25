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

    for (const pedido of aguardando) {
      if (!pedido.omie_codigo_pedido) {
        // Sem código Omie → não há como consultar. Limpa a flag para não ficar preso.
        await base44.asServiceRole.entities.Pedido.update(pedido.id, { nf_aguardando_autorizacao: false }).catch(() => {});
        semCodigo++;
        continue;
      }

      try {
        const data = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(pedido.omie_codigo_pedido) }, 'ConsultarPedido');
        const cab = data?.pedido_venda_produto?.cabecalho;
        const etapa = String(cab?.etapa || '');
        const infoNfe = data?.pedido_venda_produto?.infoNfe || data?.pedido_venda_produto?.info_nf || null;
        const nNF = infoNfe?.nNF || infoNfe?.numero_nf || cab?.numero_nfe || null;
        const cChave = infoNfe?.cChaveNFe || infoNfe?.chave_nfe || null;

        if (etapa === '60' && nNF) {
          // NF autorizada — grava número e limpa flag.
          const upd = {
            numero_nota_fiscal: String(nNF).padStart(6, '0'),
            faturado: true,
            status: 'faturado',
            status_faturamento: 'faturado',
            data_faturamento: pedido.data_faturamento || infoNfe?.dEmiNFe || new Date().toISOString(),
            nf_aguardando_autorizacao: false
          };
          if (cChave) upd.chave_nfe = String(cChave);
          await base44.asServiceRole.entities.Pedido.update(pedido.id, upd);
          preenchidos++;
          resultados.push({ pedido: pedido.numero_pedido, numero_nf: upd.numero_nota_fiscal });
        } else {
          // Etapa 50 (ou 60 sem nNF ainda) — SEFAZ não autorizou ainda. Mantém a flag.
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