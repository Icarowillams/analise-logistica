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

// ✅ ITEM 7
const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = 'https://app.omie.com.br/api/v1/geral/clientes/';
const TAMANHO_LOTE_OMIE = 50;

);
  if (typeof optsOrCall === 'string') return omieCall(base44, callOrEndpoint, param, { call: optsOrCall });
  return omieCall(base44, 'geral/clientes/', param, { call: callOrEndpoint });
}

async function chamarOmie(base44, call, param) {
  return await omieCall(base44, call, param, { cacheMinutes: 15 });
}

async function incluirIndividual(base44, payload, cliente) {
  const retorno = await chamarOmie(base44, 'IncluirCliente', payload);
  const erro = String(retorno.faultstring || '');
  if (erro) {
    const duplicado = erro.toLowerCase().includes('já cadastrado') || erro.toLowerCase().includes('ja cadastrado') || erro.toLowerCase().includes('already');
    return duplicado ? montarSucesso(cliente, { mensagem: 'Cliente já existia no Omie' }) : montarErro(cliente, erro);
  }
  return montarSucesso(cliente, retorno);
}

async function processarLoteComFallback(base44, lote, clientePorCodigo) {
  const retorno = await chamarOmie(base44, 'IncluirClientesPorLote', { lote: 1, clientes_cadastro: lote });
  const textoErro = String(retorno.faultstring || '');

  // O Omie pode retornar uma faultstring misturando erro + vários "Cliente cadastrado com sucesso".
  // Quando isso acontece, o único jeito seguro é reprocessar individualmente só esse lote para obter resultado por cliente.
  if (textoErro) {
    const resultados = [];
    for (const payload of lote) {
      const cliente = clientePorCodigo.get(payload.codigo_cliente_integracao) || {};
      resultados.push(await incluirIndividual(base44, payload, cliente));
    }
    return resultados;
  }

  const itens = retorno.clientes_cadastro || retorno.clientes || retorno.cadastro || [];
  if (!Array.isArray(itens) || itens.length === 0) {
    return lote.map(payload => montarSucesso(clientePorCodigo.get(payload.codigo_cliente_integracao) || {}, retorno));
  }

  return lote.map((payload, index) => {
    const item = itens[index] || {};
    const cliente = clientePorCodigo.get(payload.codigo_cliente_integracao) || {};
    if (item.faultstring || item.erro || item.codigo_status === '1') {
      return montarErro(cliente, item.faultstring || item.erro || item.descricao_status || 'Erro ao incluir cliente');
    }
    return montarSucesso(cliente, item);
  });
}

function montarErro(cliente, mensagem) {
  return {
    cliente_id: cliente.id,
    razao_social: cliente.razao_social || cliente.nome_fantasia,
    nome_fantasia: cliente.nome_fantasia,
    sucesso: false,
    codigo_omie: null,
    mensagem
  };
}

function montarSucesso(cliente, retorno) {
  return {
    cliente_id: cliente.id,
    razao_social: cliente.razao_social || cliente.nome_fantasia,
    nome_fantasia: cliente.nome_fantasia,
    sucesso: true,
    codigo_omie: retorno.codigo_cliente_omie || retorno.codigo_cliente || null,
    mensagem: retorno.descricao_status || retorno.mensagem || 'Cliente incluído com sucesso'
  };
}

async function atualizarCodigosOmie(base44, resultados) {
  const sucessos = resultados.filter(r => r.sucesso && r.cliente_id && r.codigo_omie);
  for (let i = 0; i < sucessos.length; i++) {
    await base44.asServiceRole.entities.Cliente.update(sucessos[i].cliente_id, { codigo_omie: String(sucessos[i].codigo_omie) }).catch(() => null);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const clienteIds = Array.isArray(body.cliente_ids) ? body.cliente_ids : [];
    let clientes = Array.isArray(body.clientes_data) ? body.clientes_data : [];

    if (clienteIds.length > 0) {
      const idsSet = new Set(clienteIds);
      const todosClientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
      clientes = todosClientes.filter(cliente => idsSet.has(cliente.id));
    }

    if (clientes.length === 0) return Response.json({ error: 'Nenhum cliente recebido' }, { status: 400 });

    console.log(`[exportarClientesOmie] Novo exportador em lote: ${clientes.length} clientes`);

    const rotas = await base44.asServiceRole.entities.Rota.list('nome', 10000).catch(() => []);
    const rotaPorId = new Map(rotas.map(rota => [rota.id, rota.nome]));

    const resultados = [];
    const validos = [];
    const clientePorCodigo = new Map();

    for (const clienteOriginal of clientes) {
      const cliente = { ...(clienteOriginal.data || {}), ...clienteOriginal, id: clienteOriginal.id };
      if (!cliente.rota_nome && cliente.rota_id && rotaPorId.has(cliente.rota_id)) {
        cliente.rota_nome = rotaPorId.get(cliente.rota_id);
      }

      if (cliente.tipo_nota === 'D1') {
        resultados.push(montarErro(cliente, 'Cliente D1 não é enviado ao Omie'));
        continue;
      }
      const doc = cliente.cnpj_cpf || cliente.cpf_cnpj;
      if (!validarDocumento(doc)) {
        resultados.push(montarErro(cliente, `CPF/CNPJ ausente ou inválido: ${doc || '-'}`));
        continue;
      }
      const payload = mapearClienteOmie(cliente);
      validos.push(payload);
      clientePorCodigo.set(payload.codigo_cliente_integracao, cliente);
    }

    for (let i = 0; i < validos.length; i += TAMANHO_LOTE_OMIE) {
      const lote = validos.slice(i, i + TAMANHO_LOTE_OMIE);
      const resultadosLote = await processarLoteComFallback(base44, lote, clientePorCodigo);
      resultados.push(...resultadosLote);
    }

    await atualizarCodigosOmie(base44, resultados);

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.length - sucessos;
    console.log(`[exportarClientesOmie] Finalizado: ${sucessos} ok / ${erros} erro`);

    return Response.json({
      resumo: { total: resultados.length, sucessos, erros },
      resultados
    });
  } catch (error) {
    console.error('[exportarClientesOmie] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});