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
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
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
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      // Tratamento de status HTTP ANTES de res.json() — num 5xx/429 o corpo não costuma ser JSON.
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 425) {
          const _cbId = '6a1e06a9aa62ceab7b3b6d97';
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p: any = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
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

const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const onlyDigits = (s) => (s || '').toString().replace(/\D/g, '');


/**
 * Importa clientes do Omie para o Base44 vinculando codigo_omie por CNPJ/CPF.
 *
 * Processa UMA PÁGINA do Omie por chamada (500 clientes/página).
 * O frontend deve chamar em loop passando `pagina` até `concluido=true`.
 *
 * Payload:
 *   - pagina: número da página do Omie a processar (default 1)
 *   - apenas_simular: true não grava, só retorna contagens
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { pagina = 1, apenas_simular = false } = body;

    // 1. Buscar UMA página do Omie (Doc Omie: máx 100 reg/página)
    const data = await omieCall(base44, 'geral/clientes/', {
      pagina, registros_por_pagina: 100, apenas_importado_api: "N"
    }, { call: 'ListarClientes' });
    if (data.faultstring) throw new Error(`Omie ListarClientes: ${data.faultstring}`);

    const clientesOmie = data.clientes_cadastro || [];
    const totalPaginas = data.total_de_paginas || 1;
    const totalRegistros = data.total_de_registros || clientesOmie.length;

    // 2. Buscar TODOS clientes Base44 (só na primeira página — depois poderíamos cachear, mas é rápido)
    const clientesBase44 = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);

    // Index Base44 por CNPJ/CPF normalizado
    const porDoc = new Map();
    for (const c of clientesBase44) {
      const d = onlyDigits(c.cnpj_cpf);
      if (d) porDoc.set(d, c);
    }

    // 3. Processar apenas os clientes desta página
    let vinculados = 0;
    let jaVinculados = 0;
    let naoEncontrados = 0;
    const atualizacoes = [];
    const naoEncontradosAmostra = [];

    for (const cOmie of clientesOmie) {
      const docOmie = onlyDigits(cOmie.cnpj_cpf);
      const codigoOmie = String(cOmie.codigo_cliente_omie || '');
      if (!docOmie || !codigoOmie) continue;

      const match = porDoc.get(docOmie);
      if (!match) {
        naoEncontrados++;
        if (naoEncontradosAmostra.length < 10) {
          naoEncontradosAmostra.push({
            codigo_omie: codigoOmie,
            nome: cOmie.razao_social,
            cnpj_cpf: cOmie.cnpj_cpf
          });
        }
        continue;
      }
      if (String(match.codigo_omie || '') === codigoOmie) {
        // Mesmo já vinculado, atualizar nome_fantasia se estiver vazio no Base44 mas preenchido no Omie
        const nfOmie = (cOmie.nome_fantasia || '').trim();
        if (nfOmie && !match.nome_fantasia) {
          atualizacoes.push({ id: match.id, codigo_omie: codigoOmie, nome_fantasia: nfOmie });
        }
        jaVinculados++;
        continue;
      }
      const nfOmie2 = (cOmie.nome_fantasia || '').trim();
      const upd = { id: match.id, codigo_omie: codigoOmie };
      if (nfOmie2 && !match.nome_fantasia) upd.nome_fantasia = nfOmie2;
      atualizacoes.push(upd);
    }

    // 4. Gravar — sequencial com retry em 429 (rate limit Base44)
    const erros = [];
    async function updateComRetry(id, data, maxTentativas = 5) {
      for (let t = 1; t <= maxTentativas; t++) {
        try {
          await base44.asServiceRole.entities.Cliente.update(id, data);
          return true;
        } catch (err) {
          const is429 = /429|Rate limit/i.test(err.message || '');
          if (is429 && t < maxTentativas) {
            await delay(1500 * t); // backoff: 1.5s, 3s, 4.5s, 6s
            continue;
          }
          erros.push({ id, erro: err.message });
          return false;
        }
      }
      return false;
    }

    if (!apenas_simular && atualizacoes.length > 0) {
      for (const up of atualizacoes) {
        const payload = { codigo_omie: up.codigo_omie };
        if (up.nome_fantasia) payload.nome_fantasia = up.nome_fantasia;
        const ok = await updateComRetry(up.id, payload);
        if (ok) vinculados++;
        await delay(120); // throttle: ~8 req/s, bem abaixo do limite
      }
    }

    return Response.json({
      sucesso: true,
      simulacao: apenas_simular,
      pagina,
      total_paginas: totalPaginas,
      total_registros_omie: totalRegistros,
      concluido: pagina >= totalPaginas,
      proxima_pagina: pagina < totalPaginas ? pagina + 1 : null,
      nesta_pagina: {
        clientes_omie: clientesOmie.length,
        novos_vinculos: apenas_simular ? atualizacoes.length : vinculados,
        ja_vinculados: jaVinculados,
        nao_encontrados: naoEncontrados,
        erros: erros.length,
        amostra_nao_encontrados: naoEncontradosAmostra
      }
    });
  } catch (error) {
    console.error('[IMPORTAR] ERRO:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});