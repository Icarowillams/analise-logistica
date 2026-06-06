import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.omie_app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.omie_app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
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
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const until = new Date(Date.now() + 30 * 60000).toISOString();
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: 'principal', bloqueado: true, bloqueado_ate: until, ultimo_erro: data.faultstring, atualizado_em: new Date().toISOString() }).catch(() => null);
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
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

// 🐛 FIX item1+2: credenciais movidas para resolverCredsOmie() — evita top-level warm-start
//   e corrige OMIE_API_KEY → OMIE_APP_KEY (nome correto do secret)
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

// Doc Omie: máximo 100 registros/página, 240 req/min (4/s), 4 simultâneas
const REGISTROS_PAGINA = 100;
const PARALELISMO = 3; // conservador (limite é 4 simultâneas)

);
  return omieCall(base44, 'geral/clientes/', param, { call: callOrEndpoint });
}) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3, cacheMinutes: 0, logIntegration: true } : opts;
  const chave = `${OMIE_URL}|${call}|${JSON.stringify(param || {})}`;
  const controles = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = controles?.[0];

  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
  }

  if (cacheMinutes > 0) {
    const caches = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
    if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
  }

  const { app_key, app_secret } = await resolverCredsOmie(base44);
  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const inicio = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(OMIE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();

    if (data.faultstring || data.faultcode) {
      const msg = String(data.faultstring || '').toLowerCase();
      const deveBloquear = res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde');
      if (deveBloquear) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
        else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
      }

      const deveTentar = res.status === 429 || msg.includes('too many') || msg.includes('aguarde') || msg.includes('cota') || msg.includes('limite de requisi') || msg.includes('internal error') || msg.includes('timeout') || msg.includes('indispon');
      ultimoErro = data.faultstring || 'Erro Omie';
      if (deveTentar && tentativa < maxRetries) {
        await new Promise(r => setTimeout(r, 2500 * tentativa));
        continue;
      }
      throw new Error(ultimoErro);
    }

    if (logIntegration) {
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: OMIE_URL,
        call,
        operacao: call,
        status: 'sucesso',
        payload_enviado: JSON.stringify(param || {}).slice(-500),
        payload_resposta: JSON.stringify(data || {}).slice(-500),
        duracao_ms: Date.now() - inicio,
        tentativas: tentativa
      }).catch(() => {});
    }
    return data;
  }

  throw new Error(ultimoErro || 'Máximo de tentativas Omie excedido');
}

async function listarClientesOmie(base44, pagina) {
  return await omieCall(base44, "ListarClientes", {
    pagina,
    registros_por_pagina: REGISTROS_PAGINA,
    apenas_importado_api: "N"
  }, { cacheMinutes: 0 });
}

async function processarLote(base44, paginas) {
  return Promise.all(paginas.map(p => listarClientesOmie(base44, p)));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { acao, job_id } = body;

    // ============ AÇÃO: progresso (polling) ============
    if (acao === 'progresso') {
      if (!job_id) return Response.json({ error: 'job_id obrigatório' }, { status: 400 });
      const job = await base44.asServiceRole.entities.JobAuditoriaOmie.get(job_id);
      if (!job) return Response.json({ error: 'Job não encontrado' }, { status: 404 });

      const resp = {
        job_id: job.id,
        status: job.status,
        etapa_descricao: job.etapa_descricao,
        pagina_atual: job.pagina_atual,
        total_paginas: job.total_paginas,
        total_omie_obtidos: job.total_omie_obtidos,
        total_omie_estimado: job.total_omie_estimado,
        total_base44: job.total_base44,
        iguais: job.iguais,
        diferentes: job.diferentes,
        so_no_base44: job.so_no_base44,
        so_no_omie: job.so_no_omie,
        erro_mensagem: job.erro_mensagem,
      };

      // Se concluído, anexar listas
      if (job.status === 'concluido') {
        try {
          resp.lista_so_base44 = JSON.parse(job.lista_so_base44 || '[]');
          resp.lista_so_omie = JSON.parse(job.lista_so_omie || '[]');
          resp.lista_diferentes = JSON.parse(job.lista_diferentes || '[]');
        } catch (_) {}
      }
      return Response.json(resp);
    }

    // ============ AÇÃO: iniciar (cria job e dispara processamento) ============
    if (acao === 'iniciar') {
      // Cria job
      const job = await base44.asServiceRole.entities.JobAuditoriaOmie.create({
        status: 'iniciando',
        etapa_descricao: 'Iniciando auditoria...',
        iniciado_em: new Date().toISOString(),
      });

      // Dispara processamento sem aguardar (fire-and-forget)
      // Como Deno serve termina ao retornar, precisamos usar EdgeRuntime.waitUntil ou
      // simplesmente processar de forma assíncrona com setTimeout(0)
      processar(base44, job.id).catch(async (err) => {
        console.error('[auditoriaClientesOmieJob] Erro:', err.message);
        try {
          await base44.asServiceRole.entities.JobAuditoriaOmie.update(job.id, {
            status: 'erro',
            erro_mensagem: err.message,
            concluido_em: new Date().toISOString(),
          });
        } catch (_) {}
      });

      return Response.json({ job_id: job.id, status: 'iniciando' });
    }

    return Response.json({ error: 'acao inválida (iniciar | progresso)' }, { status: 400 });
  } catch (error) {
    console.error('[auditoriaClientesOmieJob] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function processar(base44, jobId) {
  const update = (data) => base44.asServiceRole.entities.JobAuditoriaOmie.update(jobId, data);

  // ===== 1. Buscar primeira página pra saber total =====
  await update({ status: 'buscando_omie', etapa_descricao: 'Conectando ao Omie...' });
  const primeira = await listarClientesOmie(base44, 1);
  const totalPaginas = primeira.total_de_paginas || 1;
  const totalRegistros = primeira.total_de_registros || 0;
  const todosOmie = [...(primeira.clientes_cadastro || [])];

  await update({
    total_paginas: totalPaginas,
    total_omie_estimado: totalRegistros,
    total_omie_obtidos: todosOmie.length,
    pagina_atual: 1,
    etapa_descricao: `Página 1/${totalPaginas} (${todosOmie.length}/${totalRegistros})`,
  });

  // ===== 2. Buscar páginas restantes em paralelo =====
  const paginasRestantes = [];
  for (let p = 2; p <= totalPaginas; p++) paginasRestantes.push(p);

  for (let i = 0; i < paginasRestantes.length; i += PARALELISMO) {
    const lote = paginasRestantes.slice(i, i + PARALELISMO);
    const resultados = await processarLote(base44, lote);
    resultados.forEach(r => {
      if (r.clientes_cadastro) todosOmie.push(...r.clientes_cadastro);
    });
    const ultimaPag = lote[lote.length - 1];
    await update({
      pagina_atual: ultimaPag,
      total_omie_obtidos: todosOmie.length,
      etapa_descricao: `Página ${ultimaPag}/${totalPaginas} (${todosOmie.length}/${totalRegistros})`,
    });

  }

  // ===== 3. Buscar Base44 =====
  await update({ status: 'buscando_base44', etapa_descricao: 'Buscando clientes locais...' });
  const clientesBase44 = [];
  const PAGE = 500;
  let skip = 0;
  while (true) {
    const lote = await base44.asServiceRole.entities.Cliente.list('-created_date', PAGE, skip);
    const arr = Array.isArray(lote) ? lote : [];
    clientesBase44.push(...arr);
    if (arr.length < PAGE) break;
    skip += PAGE;
  }
  await update({ total_base44: clientesBase44.length });

  // ===== 4. Comparar =====
  await update({ status: 'comparando', etapa_descricao: `Comparando ${clientesBase44.length} clientes...` });

  const omiePorId = {};
  const omiePorCpfCnpj = {};
  todosOmie.forEach(c => {
    const codInt = (c.codigo_cliente_integracao || '').trim();
    const doc = (c.cnpj_cpf || '').replace(/\D/g, '');
    if (codInt) omiePorId[codInt] = c;
    if (doc) omiePorCpfCnpj[doc] = c;
  });

  const obterCodigoBase44 = (c) => c.codigo || c.codigo_interno || c.codigo_integracao || '';
  const base44Ids = new Set(clientesBase44.map(c => c.id));
  const base44Codigos = new Set(clientesBase44.map(c => obterCodigoBase44(c)).filter(Boolean));
  const base44CpfCnpjSet = new Set(
    clientesBase44.map(c => (c.cnpj_cpf || '').replace(/\D/g, '')).filter(Boolean)
  );

  const soNoBase44 = [];
  const diferentes = [];
  let iguais = 0;

  for (const cb of clientesBase44) {
    const docBase = (cb.cnpj_cpf || '').replace(/\D/g, '');
    const codigoBase = obterCodigoBase44(cb);
    const co = (codigoBase && omiePorId[codigoBase]) || omiePorId[cb.id] || omiePorCpfCnpj[docBase];

    if (!co) {
      // Campos enxutos pra caber mais clientes no campo limitado
      soNoBase44.push({
        id: cb.id,
        c: codigoBase || '',
        r: (cb.razao_social || '').substring(0, 60),
        f: (cb.nome_fantasia || '').substring(0, 40),
        d: cb.cnpj_cpf || '',
        ci: (cb.cidade || '').substring(0, 30),
        uf: cb.estado || '',
        s: cb.status || '',
        tn: cb.tipo_nota || '',
      });
      continue;
    }

    const diffs = [];
    const cmp = [
      ['razao_social', cb.razao_social || '', (co.razao_social || '').substring(0, 60)],
      ['cnpj_cpf', docBase, (co.cnpj_cpf || '').replace(/\D/g, '')],
      ['cidade', cb.cidade || '', co.cidade || ''],
      ['estado', (cb.estado || '').toUpperCase().substring(0, 2), (co.estado || '').toUpperCase().substring(0, 2)],
      ['inativo', cb.status === 'inativo' ? 'S' : 'N', co.inativo || 'N'],
    ];
    for (const [campo, a, b] of cmp) {
      if ((a || '').toString().trim().toUpperCase() !== (b || '').toString().trim().toUpperCase()) {
        diffs.push({ campo, base44: a, omie: b });
      }
    }
    if (diffs.length > 0) {
      // Não armazena detalhes (campo limitado) — só conta
      diferentes.push(1);
    } else {
      iguais++;
    }
  }

  const soNoOmie = [];
  for (const co of todosOmie) {
    const codInt = (co.codigo_cliente_integracao || '').trim();
    const doc = (co.cnpj_cpf || '').replace(/\D/g, '');
    const existe = (codInt && (base44Ids.has(codInt) || base44Codigos.has(codInt))) || (doc && base44CpfCnpjSet.has(doc));
    if (!existe) {
      soNoOmie.push({
        co: co.codigo_cliente_omie,
        ci: co.codigo_cliente_integracao,
        r: (co.razao_social || '').substring(0, 60),
        f: (co.nome_fantasia || '').substring(0, 40),
        d: co.cnpj_cpf || '',
        in: co.inativo || 'N',
      });
    }
  }

  // ===== 5. Salvar resultado =====
  // Salva TODOS os faltantes em uma entidade dedicada (em lotes via bulkCreate),
  // sem qualquer truncamento. O campo do job só guarda um marcador apontando pra entidade.

  // Limpa registros antigos do mesmo job (caso seja reexecução)
  try {
    const antigos = await base44.asServiceRole.entities.AuditoriaClienteFaltante.filter({ job_id: jobId });
    for (const a of antigos) {
      await base44.asServiceRole.entities.AuditoriaClienteFaltante.delete(a.id);
    }
  } catch (_) {}

  const registrosB44 = soNoBase44.map(c => ({
    job_id: jobId,
    lado: 'base44',
    cliente_id: c.id || '',
    codigo: c.c || '',
    razao_social: c.r || '',
    nome_fantasia: c.f || '',
    cnpj_cpf: c.d || '',
    cidade: c.ci || '',
    estado: c.uf || '',
    status: c.s || '',
    tipo_nota: c.tn || '',
  }));
  const registrosOmie = soNoOmie.map(c => ({
    job_id: jobId,
    lado: 'omie',
    codigo_omie: String(c.co || ''),
    codigo_integracao: c.ci || '',
    razao_social: c.r || '',
    nome_fantasia: c.f || '',
    cnpj_cpf: c.d || '',
    inativo: c.in || 'N',
  }));

  // Insere em lotes de 100
  const inserirLotes = async (registros) => {
    for (let i = 0; i < registros.length; i += 100) {
      const lote = registros.slice(i, i + 100);
      try {
        await base44.asServiceRole.entities.AuditoriaClienteFaltante.bulkCreate(lote);
      } catch (e) {
        // Fallback unitário
        for (const r of lote) {
          try { await base44.asServiceRole.entities.AuditoriaClienteFaltante.create(r); } catch (_) {}
        }
      }
    }
  };
  await inserirLotes(registrosB44);
  await inserirLotes(registrosOmie);

  // Marcadores no job: indicam que a lista está na entidade dedicada
  const jsonB44 = JSON.stringify({ __entity: 'AuditoriaClienteFaltante', job_id: jobId, lado: 'base44', count: soNoBase44.length });
  const jsonOmie = JSON.stringify({ __entity: 'AuditoriaClienteFaltante', job_id: jobId, lado: 'omie', count: soNoOmie.length });

  await update({
    status: 'concluido',
    etapa_descricao: 'Auditoria concluída',
    iguais,
    diferentes: diferentes.length,
    so_no_base44: soNoBase44.length,
    so_no_omie: soNoOmie.length,
    lista_so_base44: jsonB44,
    lista_so_omie: jsonOmie,
    lista_diferentes: '[]',
    concluido_em: new Date().toISOString(),
  });
}