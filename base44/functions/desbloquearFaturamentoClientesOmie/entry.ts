import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = Deno.env.get('OMIE_APP_KEY') || cfg?.app_key || '';
  let appSecret = Deno.env.get('OMIE_APP_SECRET') || cfg?.app_secret || '';
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
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite')) {
          lastErr = data.faultstring;
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType }).catch(() => null);
      }
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

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function estaBloqueado(cli: any) {
  const info = cli?.info || {};
  const flags = [cli?.bloquear_faturamento, info?.bloquear_faturamento, cli?.bloqueado, info?.bloqueado];
  return flags.some((v) => String(v || '').trim().toUpperCase() === 'S');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const apenasListar = body?.apenas_listar === true;
    // Lista de códigos a alterar passada direto no payload (modo alteração sem re-listar).
    const codigos: number[] = Array.isArray(body?.codigos) ? body.codigos : [];

    // ─── MODO ALTERAÇÃO: recebe os códigos e só chama AlterarCliente (sem re-listar) ───
    if (!apenasListar && codigos.length > 0) {
      const resultados: any[] = [];
      let okCount = 0;
      for (const cod of codigos) {
        let sucesso = false;
        // Trata "consumo redundante" (código 6) com espera e retry, como o Omie exige.
        for (let tentativa = 0; tentativa < 3 && !sucesso; tentativa++) {
          try {
            await omieCall(base44, 'geral/clientes/', {
              codigo_cliente_omie: cod,
              bloquear_faturamento: 'N'
            }, { call: 'AlterarCliente', operation: 'desbloquear_faturamento', entityType: 'Cliente', skipLog: true });
            okCount += 1;
            resultados.push({ codigo: cod, ok: true });
            sucesso = true;
          } catch (err: any) {
            const msg = String(err?.message || '');
            // Bloqueio severo (MISUSE / 30 min) — não adianta continuar; aborta o lote.
            if (/misuse|consumo indevido|bloqueada at/i.test(msg)) {
              resultados.push({ codigo: cod, ok: false, erro: msg.slice(0, 160) });
              return Response.json({
                sucesso: false,
                abortado: true,
                motivo: 'API Omie bloqueada por consumo indevido. Aguarde ~30 min e rode novamente.',
                desbloqueados_nesta_execucao: okCount, total: codigos.length, resultados
              });
            }
            // Consumo redundante — aguarda e tenta de novo.
            const m = msg.match(/(\d+)\s*segundo/i);
            if (/redundante/i.test(msg) && tentativa < 2) {
              await sleep(Math.min((m ? Number(m[1]) : 55) * 1000 + 2000, 60000));
              continue;
            }
            resultados.push({ codigo: cod, ok: false, erro: msg.slice(0, 160) });
            break;
          }
        }
        await sleep(2000);
      }
      return Response.json({ sucesso: true, desbloqueados_nesta_execucao: okCount, total: codigos.length, resultados });
    }

    // ─── MODO LISTAGEM: pagina todos os clientes do Omie e coleta os bloqueados ───
    const bloqueados: any[] = [];
    let pagina = 1;
    let totalPaginas = 1;

    do {
      const resp: any = await omieCall(base44, 'geral/clientes/', {
        pagina,
        registros_por_pagina: 50,
        apenas_importado_api: 'N'
      }, { call: 'ListarClientes', operation: 'listar_clientes', skipLog: true });

      totalPaginas = Number(resp?.total_de_paginas || 1);
      const lista = resp?.clientes_cadastro || [];
      for (const cli of lista) {
        if (estaBloqueado(cli)) {
          bloqueados.push({
            codigo_cliente_omie: cli?.codigo_cliente_omie,
            nome: cli?.razao_social || cli?.nome_fantasia || ''
          });
        }
      }
      pagina += 1;
    } while (pagina <= totalPaginas);

    return Response.json({
      sucesso: true,
      total_bloqueados: bloqueados.length,
      codigos: bloqueados.map((b) => b.codigo_cliente_omie),
      clientes: bloqueados
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});