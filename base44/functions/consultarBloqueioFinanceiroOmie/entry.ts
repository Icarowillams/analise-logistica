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

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const cache = new Map();
const configCache = { value: false, expiresAt: 0 };

async function getModoEconomico(base44) {
    const now = Date.now();
    if (configCache.expiresAt > now) return configCache.value;
    const configs = await base44.asServiceRole.entities.ConfiguracaoSistema.filter({ chave: 'global' });
    configCache.value = !!configs[0]?.modo_economico;
    configCache.expiresAt = now + 60000;
    return configCache.value;
}

function getCached(key) {
    const item = cache.get(key);
    if (!item || item.expiresAt <= Date.now()) return null;
    return item.data;
}

function setCached(key, data, modoEconomico) {
    const temDebito = data?.deve_bloquear || data?.tem_pendencia || (data?.total_debitos || 0) > 0;
    const ttl = temDebito ? 15 * 60 * 1000 : 30 * 60 * 1000;
    cache.set(key, { data: { ...data, origem_cache: true }, expiresAt: Date.now() + (modoEconomico ? ttl * 2 : ttl) });
}

// Consulta consolidada de bloqueio financeiro do cliente DIRETO no Omie.
// Retorna: títulos atrasados, em aberto, total débitos, limite de crédito, saldo disponível e se deve bloquear.
// Substitui o antigo consultarBloqueioFinanceiro que dependia de webhook externo.

// bloco orphan removido

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const { cliente_id, cpf_cnpj, invalidar_cache, somente_invalidar_cache, forcar_atualizacao = false } = await req.json();
        if (!cliente_id && !cpf_cnpj) {
            return Response.json({ error: 'Informe cliente_id ou cpf_cnpj' }, { status: 400 });
        }

        let cliente = null;
        let cnpjLimpo = (cpf_cnpj || '').replace(/\D/g, '');
        if (cliente_id) {
            cliente = await base44.asServiceRole.entities.Cliente.get(cliente_id);
            if (cliente && !cnpjLimpo) cnpjLimpo = (cliente.cnpj_cpf || cliente.cpf_cnpj || '').replace(/\D/g, '');
        }
        if (!cnpjLimpo) return Response.json({ error: 'CPF/CNPJ inválido' }, { status: 400 });

        if (cliente?.bloquear_faturamento === true && !forcar_atualizacao && !invalidar_cache) {
            return Response.json({
                sucesso: true,
                cliente_nome: cliente?.razao_social || cliente?.nome_fantasia || null,
                cliente_codigo: cliente?.codigo || null,
                cpf_cnpj: cnpjLimpo,
                titulos: [],
                total_titulos: 0,
                total_debitos: 0,
                titulos_atrasados: 0,
                tem_pendencia: true,
                limite_credito: 0,
                saldo_disponivel: 0,
                deve_bloquear: true,
                bloqueado_localmente: true,
                motivo: cliente.motivo_bloqueio || 'Cliente bloqueado no cadastro',
                cache_hit: false
            });
        }

        const modoEconomico = await getModoEconomico(base44);
        const cacheKey = `consultarBloqueioFinanceiroOmie:${cliente?.codigo_omie || cliente?.codigo || cliente_id || cnpjLimpo}`;
        if (invalidar_cache) cache.delete(cacheKey);
        if (somente_invalidar_cache) return Response.json({ sucesso: true, cache_invalidado: true });
        const cached = !invalidar_cache ? getCached(cacheKey) : null;
        if (cached) return Response.json({ ...cached, cache_hit: true });

        // 1. Buscar títulos ATRASADOS e EM ABERTO
        const titulosMap = new Map();
        for (const status of ['ATRASADO', 'EMABERTO']) {
            let p = 1, tp = 1;
            while (p <= tp) {
                const data = await omieCall(
                    base44,
                    "financas/contareceber/",
                    { nPagina: p, nRegPorPagina: 100, cNatureza: "R", cStatus: status, cCPFCNPJCliente: cnpjLimpo },
                    { call: 'PesquisarLancamentos' }
                );
                if (data.faultstring) break;
                tp = data.nTotPaginas || 1;
                for (const t of (data.titulosEncontrados || [])) {
                    const cab = t.cabecTitulo || t;
                    const key = `${cab.cNumTitulo || ''}|${cab.cNumParcela || ''}|${cab.dDtVenc || ''}|${cab.nValorTitulo || 0}`;
                    if (!titulosMap.has(key)) {
                        titulosMap.set(key, {
                            numero: cab.cNumTitulo || '',
                            parcela: cab.cNumParcela || '',
                            valor: cab.nValorTitulo || 0,
                            vencimento: cab.dDtVenc || '',
                            status: cab.cStatus || status,
                            tipo: cab.cTipo || '',
                            documento_fiscal: cab.cNumDocFiscal || '',
                            observacao: cab.observacao || ''
                        });
                    }
                }
                p++;
            }
        }
        const titulos = Array.from(titulosMap.values());

        // 2. Consultar cliente no Omie para pegar limite de crédito
        let limiteCredito = 0;
        let clienteOmie = await omieCall(
            base44,
            "geral/clientes/",
            { pagina: 1, registros_por_pagina: 1, clientesFiltro: { cnpj_cpf: cnpjLimpo } },
            { call: 'ListarClientes' }
        );
        if (!clienteOmie.faultstring && clienteOmie.clientes_cadastro?.[0]) {
            limiteCredito = Number(clienteOmie.clientes_cadastro[0].valor_limite_credito || 0);
        } else if (cliente?.codigo_omie || cliente?.codigo_cliente_omie || cliente?.codigo) {
            clienteOmie = await omieCall(
                base44,
                "geral/clientes/",
                { codigo_cliente_integracao: cliente.codigo || cliente.id },
                { call: 'ConsultarCliente' }
            );
            if (!clienteOmie.faultstring) limiteCredito = Number(clienteOmie.valor_limite_credito || 0);
        }

        const totalDebitos = titulos.reduce((s, t) => s + (Number(t.valor) || 0), 0);
        const titulosAtrasados = titulos.filter(t => t.status === 'ATRASADO').length;
        const saldoDisponivel = limiteCredito - totalDebitos;
        const temPendencia = titulosAtrasados > 0;
        const deveBloquear = temPendencia || (limiteCredito > 0 && saldoDisponivel < 0);

        if (cliente?.id) {
            await base44.asServiceRole.entities.Cliente.update(cliente.id, {
                pendencia_financeira: deveBloquear,
                pendencia_financeira_atualizada_em: new Date().toISOString()
            });
        }

        const resultado = {
            sucesso: true,
            cliente_nome: cliente?.razao_social || cliente?.nome_fantasia || null,
            cliente_codigo: cliente?.codigo || null,
            cpf_cnpj: cnpjLimpo,
            titulos,
            total_titulos: titulos.length,
            total_debitos: totalDebitos,
            titulos_atrasados: titulosAtrasados,
            tem_pendencia: temPendencia,
            limite_credito: limiteCredito,
            saldo_disponivel: saldoDisponivel,
            deve_bloquear: deveBloquear,
            cache_hit: false
        };
        setCached(cacheKey, resultado, modoEconomico);
        return Response.json(resultado);
    } catch (error) {
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});