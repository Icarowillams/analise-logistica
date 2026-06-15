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

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL_CENARIOS = "https://app.omie.com.br/api/v1/geral/cenarios/";
const OMIE_URL_ETAPAS = "https://app.omie.com.br/api/v1/produtos/etapafat/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function logOmie(base44, payload) {
  try { await base44.asServiceRole.entities.LogIntegracaoOmie.create(payload); } catch (_) {}
}


async function listarTodosCenarios(base44) {
  const registros = [];
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const data = await omieCall(base44, 'geral/cenarios/', {
      nPagina: pagina, nRegPorPagina: 50
    }, { call: 'ListarCenarios' });
    await delay(800);
    if (data.faultstring) throw new Error(`ListarCenarios: ${data.faultstring}`);
    totalPaginas = data.nTotPaginas || 1;
    if (data.cenariosEncontrados) registros.push(...data.cenariosEncontrados);
    pagina++;
  }
  return registros;
}

async function listarTodasEtapas(base44) {
  const registros = [];
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const data = await omieCall(base44, 'produtos/etapafat/', {
      pagina, registros_por_pagina: 50
    }, { call: 'ListarEtapasFaturamento' });
    await delay(800);
    if (data.faultstring) {
      if (/nenhum/i.test(data.faultstring)) return registros;
      throw new Error(`ListarEtapasFaturamento: ${data.faultstring}`);
    }
    totalPaginas = data.total_de_paginas || 1;
    if (data.cadastros) registros.push(...data.cadastros);
    pagina++;
  }
  return registros;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const startedAt = Date.now();
    const existentes = await base44.asServiceRole.entities.CenarioFiscal.list();

    // ==========================================
    // IMPORTAR CENÁRIOS (Naturezas de Operação)
    // ==========================================
    let cenariosOmie = [];
    let cenariosErro = null;
    try {
      cenariosOmie = await listarTodosCenarios(base44);
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('chave de acesso') || msg.includes('não preenchida') || msg.includes('nao preenchida')) {
        cenariosErro = 'Módulo "Cenários de Impostos" não habilitado nesta conta Omie — apenas Etapas serão sincronizadas.';
      } else {
        throw err;
      }
    }
    let cenariosCriados = 0, cenariosAtualizados = 0;
    const resultadoCenarios = [];

    for (const c of cenariosOmie) {
      const omieId = String(c.nCodigo || '');
      const nome = c.cNome || 'Sem nome';
      const ativo = c.inativo !== 'S';

      const existente = existentes.find(
        e => e.tipo_registro === 'cenario' && e.omie_id === omieId
      );

      const dados = {
        tipo_registro: 'cenario',
        omie_id: omieId,
        codigo: omieId,
        nome,
        padrao: !!c.padrao,
        status: ativo ? 'ativo' : 'inativo'
      };

      if (existente) {
        await base44.asServiceRole.entities.CenarioFiscal.update(existente.id, dados);
        cenariosAtualizados++;
        resultadoCenarios.push({ nome, omie_id: omieId, status: 'atualizado' });
      } else {
        await base44.asServiceRole.entities.CenarioFiscal.create(dados);
        cenariosCriados++;
        resultadoCenarios.push({ nome, omie_id: omieId, status: 'criado' });
      }
      await delay(150);
    }

    // ==========================================
    // IMPORTAR ETAPAS DE FATURAMENTO (achatar estrutura aninhada)
    // Omie retorna: [{ cCodOperacao, cDescOperacao, etapas: [{cCodigo, cDescricao, cInativo}] }]
    // ==========================================
    const operacoesOmie = await listarTodasEtapas(base44);
    const etapasFlat = [];
    for (const op of operacoesOmie) {
      if (!op?.cCodOperacao || !Array.isArray(op.etapas)) continue;
      for (const et of op.etapas) {
        etapasFlat.push({
          cCodOperacao: op.cCodOperacao,
          cDescOperacao: op.cDescOperacao || '',
          cCodigo: et.cCodigo,
          cDescricao: et.cDescricao || et.cDescrPadrao || '',
          cInativo: et.cInativo
        });
      }
    }

    let etapasCriadas = 0, etapasAtualizadas = 0;
    const resultadoEtapas = [];

    for (const e of etapasFlat) {
      // Código composto: operação + etapa (ex: "11-50" = Venda de Produto / Faturar)
      const codigo = `${e.cCodOperacao}-${e.cCodigo}`;
      const nome = `${e.cDescOperacao} / ${e.cDescricao || 'Sem descrição'}`;
      const ativo = e.cInativo !== 'S';

      const existente = existentes.find(
        ex => ex.tipo_registro === 'etapa' && ex.codigo === codigo
      );

      const dados = {
        tipo_registro: 'etapa',
        codigo,
        omie_id: codigo,
        nome,
        descricao: e.cDescOperacao,
        status: ativo ? 'ativo' : 'inativo'
      };

      if (existente) {
        await base44.asServiceRole.entities.CenarioFiscal.update(existente.id, dados);
        etapasAtualizadas++;
        resultadoEtapas.push({ codigo, nome, status: 'atualizada' });
      } else {
        await base44.asServiceRole.entities.CenarioFiscal.create(dados);
        etapasCriadas++;
        resultadoEtapas.push({ codigo, nome, status: 'criada' });
      }
      await delay(100);
    }

    const duracao_ms = Date.now() - startedAt;

    await logOmie(base44, {
      endpoint: 'geral/cenarios+produtos/etapafat',
      call: 'ListarCenarios+ListarEtapasFaturamento',
      operacao: 'importar_cenarios_fiscais',
      status: 'sucesso',
      mensagem_erro: `Cenários: ${cenariosCriados} criados, ${cenariosAtualizados} atualizados. Etapas: ${etapasCriadas} criadas, ${etapasAtualizadas} atualizadas.`,
      duracao_ms,
      usuario_email: user.email
    });

    return Response.json({
      sucesso: true,
      cenarios: {
        total_omie: cenariosOmie.length,
        criados: cenariosCriados,
        atualizados: cenariosAtualizados,
        detalhes: resultadoCenarios,
        aviso: cenariosErro
      },
      etapas: {
        total_omie: etapasFlat.length,
        total_operacoes: operacoesOmie.length,
        criadas: etapasCriadas,
        atualizadas: etapasAtualizadas,
        detalhes: resultadoEtapas
      },
      duracao_ms
    });
  } catch (error) {
    console.error('[importarCenariosFiscaisOmie] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});