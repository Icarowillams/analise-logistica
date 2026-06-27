import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

// Environment-First SEM cache: Deno.env é atômico e sem TTL — nunca serve chave velha durante
// troca de credencial. ConfiguracaoOmie é só fallback.
async function getOmieCredentials(base44: any) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
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
          { const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
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

function normalizarCpfCnpj(doc) {
  return (doc || '').replace(/[.\-\/\s]/g, '');
}

function normalizarEstado(estado) {
  const map = {
    'acre':'AC','alagoas':'AL','amapa':'AP','amazonas':'AM','bahia':'BA','ceara':'CE',
    'distrito federal':'DF','espirito santo':'ES','goias':'GO','maranhao':'MA','mato grosso':'MT',
    'mato grosso do sul':'MS','minas gerais':'MG','para':'PA','paraiba':'PB','parana':'PR',
    'pernambuco':'PE','piaui':'PI','rio de janeiro':'RJ','rio grande do norte':'RN',
    'rio grande do sul':'RS','rondonia':'RO','roraima':'RR','santa catarina':'SC',
    'sao paulo':'SP','sergipe':'SE','tocantins':'TO'
  };
  let n = (estado || '').trim();
  if (n.length > 2) {
    const chave = n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    n = map[chave] || n.substring(0, 2).toUpperCase();
  } else {
    n = n.toUpperCase();
  }
  return n;
}

function mapearCliente(c, rotaNome, vendedorNome) {
  const cnpj = normalizarCpfCnpj(c.cnpj_cpf);
  const isPF = cnpj.length <= 11;
  const ieRaw = String(c.inscricao_estadual || '').trim();
  const ieDigitos = ieRaw.replace(/\D/g, '');
  const ieLixo = !ieDigitos || /^isent/i.test(ieRaw) || ieDigitos.length < 2 || /^(\d)\1+$/.test(ieDigitos);

  const obj = {
    codigo_cliente_integracao: c.codigo_interno || c.id,
    razao_social: (c.razao_social || c.nome_fantasia || 'Cliente sem nome').substring(0, 60),
    nome_fantasia: (c.nome_fantasia || c.razao_social || '').substring(0, 100),
    cnpj_cpf: cnpj,
    pessoa_fisica: isPF ? 'S' : 'N',
    endereco: (c.endereco || '').substring(0, 60),
    endereco_numero: (c.numero || 'S/N').substring(0, 10),
    bairro: (c.bairro || '').substring(0, 60),
    cidade: (c.cidade || '').substring(0, 60),
    estado: normalizarEstado(c.estado),
    cep: (c.cep || '').replace(/\D/g, '').substring(0, 8),
    email: (c.email || 'nfe@paoemel.com.br').substring(0, 500),
    contribuinte: isPF ? 'N' : (ieLixo ? 'N' : 'S'),
    inscricao_estadual: isPF ? '' : (ieLixo ? 'ISENTO' : ieDigitos),
    inativo: (c.status || 'ativo').toLowerCase() === 'inativo' ? 'S' : 'N',
    tags: c.codigo_interno ? [{ tag: `COD:${c.codigo_interno}` }] : [],
    caracteristicas: [
      ...(rotaNome ? [{ campo: 'Rotas', conteudo: rotaNome }] : []),
      ...(vendedorNome ? [{ campo: 'Vendedor', conteudo: vendedorNome }] : [])
    ]
  };

  // Remover campos vazios
  const manter = ['codigo_cliente_integracao', 'razao_social', 'pessoa_fisica', 'contribuinte', 'inativo', 'inscricao_estadual'];
  for (const [k, v] of Object.entries(obj)) {
    if (manter.includes(k)) continue;
    if (v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete obj[k];
  }
  return obj;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
  const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    return Response.json({ error: 'Credenciais Omie não configuradas' }, { status: 500 });
  }

  // Buscar clientes ativos sem codigo_omie, não-D1, com CNPJ
  const todos = await base44.asServiceRole.entities.Cliente.filter({}, '-created_date', 500);
  const candidatos = todos.filter(c =>
    c.status === 'ativo' &&
    !c.codigo_omie &&
    !c.codigo_cliente_omie &&
    c.tipo_nota !== 'D1' &&
    c.cnpj_cpf
  );

  console.log(`[exportarLote] Candidatos: ${candidatos.length}`);

  // Pré-carregar rotas e vendedores para resolver nomes
  const rotas = await base44.asServiceRole.entities.Rota.list().catch(() => []);
  const vendedores = await base44.asServiceRole.entities.Vendedor.list().catch(() => []);
  const rotaMap = Object.fromEntries((rotas || []).map(r => [r.id, r.nome]));
  const vendedorMap = Object.fromEntries((vendedores || []).map(v => [v.id, v.nome]));

  const sucesso = [];
  const erros = [];

  for (let i = 0; i < candidatos.length; i++) {
    const c = candidatos[i];
    const rotaNome = c.rota_id ? (rotaMap[c.rota_id] || '') : '';
    const vendedorNome = c.vendedor_id ? (vendedorMap[c.vendedor_id] || '') : '';
    const payload = mapearCliente(c, rotaNome, vendedorNome);

    console.log(`[exportarLote] ${i + 1}/${candidatos.length} — ${c.razao_social}`);

    try {
      // Pré-consulta por CNPJ para resolver duplicidades
      const cnpj = payload.cnpj_cpf;
      try {
        const existente = await omieCall(base44, 'geral/clientes/', {
          pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N',
          clientesFiltro: { cnpj_cpf: cnpj }
        }, { call: 'ListarClientes' });
        const cli = existente?.clientes_cadastro?.[0];
        if (cli?.codigo_cliente_omie) {
          payload.codigo_cliente_omie = Number(cli.codigo_cliente_omie);
          if (cli.codigo_cliente_integracao) payload.codigo_cliente_integracao = cli.codigo_cliente_integracao;
          await base44.asServiceRole.entities.Cliente.update(c.id, {
            codigo_omie: String(cli.codigo_cliente_omie),
            codigo_cliente_omie: String(cli.codigo_cliente_omie)
          });
        }
      } catch (_) { /* segue sem pré-consulta */ }

      const resultado = await omieCall(base44, 'geral/clientes/', payload, { call: 'UpsertCliente' });

      if (resultado.faultstring) {
        // Tentar resolver duplicidade
        if (String(resultado.faultstring).toLowerCase().includes('cliente já cadastrado para o cpf/cnpj')) {
          const existente = await omieCall(base44, 'geral/clientes/', {
            pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N',
            clientesFiltro: { cnpj_cpf: cnpj }
          }, { call: 'ListarClientes' });
          const cli = existente?.clientes_cadastro?.[0];
          if (cli?.codigo_cliente_omie) {
            payload.codigo_cliente_omie = Number(cli.codigo_cliente_omie);
            if (cli.codigo_cliente_integracao) payload.codigo_cliente_integracao = cli.codigo_cliente_integracao;
            const retry = await omieCall(base44, 'geral/clientes/', payload, { call: 'UpsertCliente' });
            if (!retry.faultstring) {
              const cod = cli.codigo_cliente_omie;
              await base44.asServiceRole.entities.Cliente.update(c.id, { codigo_omie: String(cod), codigo_cliente_omie: String(cod) });
              sucesso.push({ id: c.id, razao_social: c.razao_social, cnpj_cpf: c.cnpj_cpf, codigo_omie: cod, nota: 'duplicidade resolvida' });
              console.log(`  ✅ OK (dup resolvida) — ${cod}`);
              if (i < candidatos.length - 1) await new Promise(r => setTimeout(r, 1500));
              continue;
            }
            erros.push({ id: c.id, razao_social: c.razao_social, cnpj_cpf: c.cnpj_cpf, erro: retry.faultstring });
            console.log(`  ❌ ${retry.faultstring}`);
            if (i < candidatos.length - 1) await new Promise(r => setTimeout(r, 1500));
            continue;
          }
        }
        erros.push({ id: c.id, razao_social: c.razao_social, cnpj_cpf: c.cnpj_cpf, erro: resultado.faultstring });
        console.log(`  ❌ ${resultado.faultstring}`);
      } else {
        const cod = resultado.codigo_cliente_omie || payload.codigo_cliente_omie;
        if (cod) {
          await base44.asServiceRole.entities.Cliente.update(c.id, { codigo_omie: String(cod), codigo_cliente_omie: String(cod) });
        }
        sucesso.push({ id: c.id, razao_social: c.razao_social, cnpj_cpf: c.cnpj_cpf, codigo_omie: cod });
        console.log(`  ✅ OK — ${cod}`);
      }
    } catch (err) {
      erros.push({ id: c.id, razao_social: c.razao_social, cnpj_cpf: c.cnpj_cpf, erro: err.message });
      console.log(`  ❌ Exceção: ${err.message}`);
    }

    if (i < candidatos.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  // Verificar cliente 22947
  let cliente22947 = null;
  try {
    cliente22947 = await base44.asServiceRole.entities.Cliente.get('6a1dba2e928d50ff5f39e45c');
  } catch (_) {}

  return Response.json({
    resumo: { total_candidatos: candidatos.length, exportados_com_sucesso: sucesso.length, com_erro: erros.length },
    sucesso,
    erros,
    verificacao_22947: cliente22947 ? {
      id: cliente22947.id, razao_social: cliente22947.razao_social,
      codigo_omie: cliente22947.codigo_omie, codigo_cliente_omie: cliente22947.codigo_cliente_omie
    } : 'Não encontrado'
  });
});