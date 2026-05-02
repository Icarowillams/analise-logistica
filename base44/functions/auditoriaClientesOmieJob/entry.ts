import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

// Doc Omie: máximo 100 registros/página, 240 req/min (4/s), 4 simultâneas
const REGISTROS_PAGINA = 100;
const PARALELISMO = 3; // conservador (limite é 4 simultâneas)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function listarClientesOmie(pagina, tentativa = 0) {
  const res = await fetch(OMIE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call: "ListarClientes",
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{
        pagina,
        registros_por_pagina: REGISTROS_PAGINA,
        apenas_importado_api: "N"
      }]
    })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const fc = String(data.faultcode || '');
    // Doc Omie: 425 = rate limit, 520 = transiente. Backoff exponencial.
    const isRate = msg.includes('too many') || msg.includes('aguarde') || msg.includes('cota')
      || msg.includes('limite de requisi') || msg.includes('internal error') || msg.includes('timeout') || msg.includes('indispon')
      || fc.includes('425') || fc.includes('520') || res.status === 429;
    if (isRate && tentativa < 4) {
      await sleep(2000 * (tentativa + 1));
      return listarClientesOmie(pagina, tentativa + 1);
    }
    throw new Error(`Pag ${pagina}: ${data.faultstring}`);
  }
  return data;
}

async function processarLote(paginas) {
  return Promise.all(paginas.map(p => listarClientesOmie(p)));
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
  const primeira = await listarClientesOmie(1);
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
    const resultados = await processarLote(lote);
    resultados.forEach(r => {
      if (r.clientes_cadastro) todosOmie.push(...r.clientes_cadastro);
    });
    const ultimaPag = lote[lote.length - 1];
    await update({
      pagina_atual: ultimaPag,
      total_omie_obtidos: todosOmie.length,
      etapa_descricao: `Página ${ultimaPag}/${totalPaginas} (${todosOmie.length}/${totalRegistros})`,
    });
    // Pausa pra respeitar 240 req/min = 4/s. Com PARALELISMO=3 por lote, aguarda 1s.
    if (i + PARALELISMO < paginasRestantes.length) await sleep(1000);
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

  const base44Ids = new Set(clientesBase44.map(c => c.id));
  const base44Codigos = new Set(clientesBase44.map(c => c.codigo).filter(Boolean));
  const base44CpfCnpjSet = new Set(
    clientesBase44.map(c => (c.cnpj_cpf || '').replace(/\D/g, '')).filter(Boolean)
  );

  const soNoBase44 = [];
  const diferentes = [];
  let iguais = 0;

  for (const cb of clientesBase44) {
    const docBase = (cb.cnpj_cpf || '').replace(/\D/g, '');
    const co = (cb.codigo && omiePorId[cb.codigo]) || omiePorId[cb.id] || omiePorCpfCnpj[docBase];

    if (!co) {
      // Campos enxutos pra caber mais clientes no campo limitado
      soNoBase44.push({
        id: cb.id,
        c: cb.codigo || '',
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
  // Sobe as listas como arquivo (UploadFile) e salva só a URL no campo,
  // pra não estourar o limite de tamanho do campo (independente do volume).
  const subirLista = async (lista, nome) => {
    if (!lista || lista.length === 0) return '[]';
    try {
      const json = JSON.stringify(lista);
      const blob = new Blob([json], { type: 'application/json' });
      const file = new File([blob], `${nome}_${Date.now()}.json`, { type: 'application/json' });
      const res = await base44.asServiceRole.integrations.Core.UploadFile({ file });
      const url = res?.file_url || res?.data?.file_url;
      if (!url) throw new Error('Upload sem URL');
      return JSON.stringify({ __url: url, count: lista.length });
    } catch (e) {
      console.error(`[upload ${nome}] ${e.message}`);
      // Fallback: tenta cortar pra caber no campo
      const truncada = lista.slice(0, 100);
      return JSON.stringify(truncada);
    }
  };

  const [jsonB44, jsonOmie] = await Promise.all([
    subirLista(soNoBase44, 'audit_b44'),
    subirLista(soNoOmie, 'audit_omie'),
  ]);

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