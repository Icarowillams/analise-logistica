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

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: '6a1e06a9aa62ceab7b3b6d97' }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function setCircuitBreakerBlocked(base44: any, msg: string) {
  const m = String(msg).match(/(\d+)\s*segundo/i);
  const segs = m ? Math.min(Number(m[1]) + 10, 1800) : 0;
  if (segs <= 0) return;
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', {
    bloqueado: true,
    bloqueado_ate: new Date(Date.now() + segs * 1000).toISOString(),
    ultimo_erro: String(msg).slice(0, 500),
    atualizado_em: new Date().toISOString()
  }).catch(() => null);
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
    clearTimeout(tid);
    if (res.status >= 425) {
      const corpo = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`);
    }
    const data = await res.json();
    if (data.faultstring) throw new Error(data.faultstring);
    return data;
  } catch (e: any) {
    clearTimeout(tid);
    if (e.name === 'AbortError') throw new Error('Timeout na chamada Omie');
    throw e;
  }
}
// ═══ fim omieClient inline ═══

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const PROGRESSO_ID_KEY = 'desbloqueio_clientes_omie';
const LOTE = 8; // clientes por execução — mantém a função rápida e dentro do limite de tempo

/**
 * Worker incremental: desbloqueia faturamento dos clientes pendentes em lotes pequenos.
 * Lê a fila persistida em CacheOmieConsulta (chave PROGRESSO_ID_KEY). A automação chama
 * esta função a cada 10 min; ela só age se o Omie estiver liberado.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // 1) Se o Omie estiver bloqueado, sai sem fazer nada (não renova o bloqueio).
    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) {
      return Response.json({ pulado: true, motivo: 'Omie ainda bloqueado', ate: cb.blockedUntil });
    }

    // 2) Lê a fila de códigos pendentes do cache persistente.
    const rows = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave: PROGRESSO_ID_KEY }, '-created_date', 1).catch(() => []);
    const reg = rows?.[0];
    const pendentes: number[] = Array.isArray(reg?.valor?.pendentes) ? reg.valor.pendentes : [];

    if (pendentes.length === 0) {
      return Response.json({ concluido: true, motivo: 'Nenhum cliente pendente na fila' });
    }

    // 3) Processa um lote pequeno.
    const lote = pendentes.slice(0, LOTE);
    const restantes = pendentes.slice(LOTE);
    const resultados: any[] = [];
    let okCount = 0;

    for (const cod of lote) {
      try {
        await omieCall(base44, 'geral/clientes/', { codigo_cliente_omie: cod, bloquear_faturamento: 'N' }, { call: 'AlterarCliente' });
        okCount += 1;
        resultados.push({ codigo: cod, ok: true });
      } catch (err: any) {
        const msg = String(err?.message || '');
        // Bloqueio severo — grava o breaker, devolve o lote inteiro à fila e para.
        if (/misuse|consumo indevido|425/i.test(msg)) {
          await setCircuitBreakerBlocked(base44, msg);
          const fila = [...lote, ...restantes];
          await base44.asServiceRole.entities.CacheOmieConsulta.update(reg.id, {
            valor: { pendentes: fila, atualizado_em: new Date().toISOString() },
            expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          }).catch(() => null);
          return Response.json({ abortado: true, motivo: 'Omie aplicou bloqueio severo', desbloqueados: okCount, restam: fila.length });
        }
        // Consumo redundante — devolve este código ao fim da fila e segue.
        if (/redundante/i.test(msg)) {
          restantes.push(cod);
          resultados.push({ codigo: cod, ok: false, reenfileirado: true });
          await sleep(3000);
          continue;
        }
        resultados.push({ codigo: cod, ok: false, erro: msg.slice(0, 160) });
      }
      await sleep(2500);
    }

    // 4) Atualiza a fila persistida com o que sobrou.
    await base44.asServiceRole.entities.CacheOmieConsulta.update(reg.id, {
      valor: { pendentes: restantes, atualizado_em: new Date().toISOString() },
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    }).catch(() => null);

    return Response.json({ sucesso: true, desbloqueados_nesta_execucao: okCount, restam: restantes.length, resultados });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});