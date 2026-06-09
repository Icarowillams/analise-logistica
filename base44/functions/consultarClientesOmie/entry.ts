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

// ✅ ITEM 7
const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";
const clientesCache = new Map();
const configCache = { value: false, expiresAt: 0 };

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// omieCall robusto: circuit breaker + 425 (bloqueio 30min, sem retry) + retry 429 + log padronizado.

async function getModoEconomico(base44) {
    const now = Date.now();
    if (configCache.expiresAt > now) return configCache.value;
    const configs = await base44.asServiceRole.entities.ConfiguracaoSistema.filter({ chave: 'global' });
    configCache.value = !!configs[0]?.modo_economico;
    configCache.expiresAt = now + 60000;
    return configCache.value;
}

function getCached(key) {
    const item = clientesCache.get(key);
    if (!item || item.expiresAt <= Date.now()) return null;
    return item.data;
}

function setCached(key, data, modoEconomico) {
    const ttl = modoEconomico ? 60 * 60 * 1000 : 30 * 60 * 1000;
    clientesCache.set(key, { data: { ...data, origem_cache: true }, expiresAt: Date.now() + ttl });
}

// Doc Omie: máx 100 reg/pág, 4 simultâneas, 240 req/min. Backoff em 425/520/429.
async function listarClientesOmie(base44, pagina = 1, registrosPorPagina = 100) {
    return await omieCall(base44, "ListarClientes", {
        pagina,
        registros_por_pagina: Math.min(registrosPorPagina, 100),
        clientesFiltro: { }
    });
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { acao, pagina_omie } = body;
        const modoEconomico = await getModoEconomico(base44);
        // acao: 'listar_omie' (paginado), 'comparar' (busca tudo e compara)

        if (acao === 'listar_omie') {
            // Retorna uma página de clientes do Omie
            const pag = pagina_omie || 1;
            const cacheKey = `consultarClientesOmie:listar_omie:${pag}`;
            const cached = getCached(cacheKey);
            if (cached) return Response.json({ ...cached, cache_hit: true });
            const resultado = await listarClientesOmie(base44, pag, 100);
            
            if (resultado.faultstring) {
                return Response.json({ error: resultado.faultstring }, { status: 400 });
            }

            const clientes = (resultado.clientes_cadastro || []).map(c => ({
                codigo_omie: c.codigo_cliente_omie,
                codigo_integracao: c.codigo_cliente_integracao,
                razao_social: c.razao_social || '',
                nome_fantasia: c.nome_fantasia || '',
                cnpj_cpf: c.cnpj_cpf || '',
                endereco: c.endereco || '',
                endereco_numero: c.endereco_numero || '',
                bairro: c.bairro || '',
                cidade: c.cidade || '',
                estado: c.estado || '',
                cep: c.cep || '',
                email: c.email || '',
                inscricao_estadual: c.inscricao_estadual || '',
                inativo: c.inativo || 'N',
                tags: (c.tags || []).map(t => t.tag).join(', '),
                pessoa_fisica: c.pessoa_fisica || 'N',
            }));

            const resposta = {
                sucesso: true,
                pagina: pag,
                total_paginas: resultado.total_de_paginas || 1,
                total_registros: resultado.total_de_registros || 0,
                clientes,
                cache_hit: false
            };
            setCached(cacheKey, resposta, modoEconomico);
            return Response.json(resposta);
        }

        if (acao === 'comparar') {
            // Buscar TODOS os clientes do Omie (paginado, em paralelo controlado)
            const todosOmie = [];
            const soNoBase44 = [];
            const soNoOmie = [];
            const diferentes = [];
            let iguais = 0;
            const PARALELISMO = 3;

            // Primeira página → descobre total
            const primeira = await listarClientesOmie(base44, 1, 100);
            if (primeira.faultstring) {
                return Response.json({ error: `Erro Omie pag 1: ${primeira.faultstring}` }, { status: 400 });
            }
            const totalPaginas = primeira.total_de_paginas || 1;
            todosOmie.push(...(primeira.clientes_cadastro || []));

            // Demais páginas em lotes paralelos (3 simultâneas, abaixo do limite de 4)
            const paginasRestantes = [];
            for (let p = 2; p <= totalPaginas; p++) paginasRestantes.push(p);
            for (let i = 0; i < paginasRestantes.length; i += PARALELISMO) {
                const lote = paginasRestantes.slice(i, i + PARALELISMO);
                const resultados = await Promise.all(lote.map(p => listarClientesOmie(base44, p, 100)));
                for (const r of resultados) {
                    if (r.clientes_cadastro) todosOmie.push(...r.clientes_cadastro);
                }
                if (i + PARALELISMO < paginasRestantes.length) await delay(1000);
            }

            // Buscar todos os clientes do Base44 com paginação
            const clientesBase44 = [];
            const PAGE_SIZE = 500;
            let skip = 0;

            while (true) {
                const lote = await base44.asServiceRole.entities.Cliente.list('-created_date', PAGE_SIZE, skip);
                const registros = Array.isArray(lote) ? lote : [];
                clientesBase44.push(...registros);

                if (registros.length < PAGE_SIZE) break;
                skip += PAGE_SIZE;
            }

            // Indexar Omie por id de integração, por código e por CPF/CNPJ normalizado
            const omieMapPorId = {};
            const omieMapPorCpfCnpj = {};
            todosOmie.forEach(c => {
                const codigoIntegracao = (c.codigo_cliente_integracao || '').trim();
                const cpfCnpj = (c.cnpj_cpf || '').replace(/\D/g, '');
                if (codigoIntegracao) omieMapPorId[codigoIntegracao] = c;
                if (cpfCnpj) omieMapPorCpfCnpj[cpfCnpj] = c;
            });

            const base44Ids = new Set(clientesBase44.map(c => c.id));
            const base44Codigos = new Set(clientesBase44.map(c => c.codigo).filter(Boolean));

            // Clientes no Base44 — considerar existente se bater por código, ID de integração OU CPF/CNPJ
            for (const cb of clientesBase44) {
                const cpfCnpjBase44 = (cb.cpf_cnpj || '').replace(/\D/g, '');
                const co = (cb.codigo && omieMapPorId[cb.codigo]) || omieMapPorId[cb.id] || omieMapPorCpfCnpj[cpfCnpjBase44];

                if (!co) {
                    soNoBase44.push({
                        id: cb.id,
                        codigo: cb.codigo,
                        razao_social: cb.razao_social,
                        nome_fantasia: cb.nome_fantasia,
                        cpf_cnpj: cb.cpf_cnpj,
                        status: cb.status,
                    });
                    continue;
                }

                const diffs = [];
                const comparar = [
                    ['razao_social', cb.razao_social || '', (co.razao_social || '').substring(0, 60)],
                    ['nome_fantasia', cb.nome_fantasia || '', co.nome_fantasia || ''],
                    ['cnpj_cpf', cpfCnpjBase44, (co.cnpj_cpf || '').replace(/\D/g, '')],
                    ['endereco', cb.endereco || '', co.endereco || ''],
                    ['numero', cb.numero || '', co.endereco_numero || ''],
                    ['bairro', cb.bairro || '', co.bairro || ''],
                    ['cidade', cb.cidade || '', co.cidade || ''],
                    ['estado', (cb.estado || '').toUpperCase().substring(0, 2), (co.estado || '').toUpperCase().substring(0, 2)],
                    ['cep', (cb.cep || '').replace(/\D/g, ''), (co.cep || '').replace(/\D/g, '')],
                    ['inativo', cb.status === 'inativo' ? 'S' : 'N', co.inativo || 'N'],
                ];

                for (const [campo, valBase44, valOmie] of comparar) {
                    const a = (valBase44 || '').toString().trim().toUpperCase();
                    const b = (valOmie || '').toString().trim().toUpperCase();
                    if (a !== b) {
                        diffs.push({ campo, base44: valBase44, omie: valOmie });
                    }
                }

                if (diffs.length > 0) {
                    diferentes.push({
                        id: cb.id,
                        codigo: cb.codigo,
                        razao_social: cb.razao_social,
                        nome_fantasia: cb.nome_fantasia,
                        diffs
                    });
                } else {
                    iguais++;
                }
            }

            // Clientes no Omie que NÃO estão no Base44 por ID e nem por CPF/CNPJ
            const base44CpfCnpjSet = new Set(
                clientesBase44.map(c => (c.cpf_cnpj || '').replace(/\D/g, '')).filter(Boolean)
            );

            for (const co of todosOmie) {
                const codigoIntegracao = (co.codigo_cliente_integracao || '').trim();
                const cpfCnpj = (co.cnpj_cpf || '').replace(/\D/g, '');
                const existeNoBase44 = (codigoIntegracao && (base44Ids.has(codigoIntegracao) || base44Codigos.has(codigoIntegracao))) || (cpfCnpj && base44CpfCnpjSet.has(cpfCnpj));

                if (!existeNoBase44) {
                    soNoOmie.push({
                        codigo_omie: co.codigo_cliente_omie,
                        codigo_integracao: co.codigo_cliente_integracao,
                        razao_social: co.razao_social,
                        nome_fantasia: co.nome_fantasia,
                        cnpj_cpf: co.cnpj_cpf,
                        inativo: co.inativo,
                        tags: (co.tags || []).map(t => t.tag).join(', '),
                    });
                }
            }

            return Response.json({
                sucesso: true,
                total_omie: todosOmie.length,
                total_base44: clientesBase44.length,
                iguais,
                diferentes: diferentes.length,
                so_no_base44: soNoBase44.length,
                so_no_omie: soNoOmie.length,
                lista_diferentes: diferentes,
                lista_so_base44: soNoBase44,
                lista_so_omie: soNoOmie,
            });
        }

        return Response.json({ error: 'acao inválida (listar_omie, comparar)' }, { status: 400 });

    } catch (error) {
        console.error('[consultarClientesOmie] Erro:', error.message);
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});