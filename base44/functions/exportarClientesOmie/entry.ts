import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = 'https://app.omie.com.br/api/v1/geral/clientes/';
const TAMANHO_LOTE_OMIE = 50;
let base44Global = null;

async function omieCall(call, param, opts = {}) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
  const url = OMIE_URL;
  const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
  const cb = await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) return { faultstring: `API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`, faultcode: 'CIRCUIT_OPEN' };
  if (cacheMinutes > 0) {
    const caches = await base44Global.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
    if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
  }
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] }) });
      clearTimeout(timeout);
      const data = await response.json();
      if (data.faultstring || data.faultcode) {
        const msg = String(data.faultstring || '').toLowerCase();
        if (response.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
          const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
          if (controle?.id) await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
          return data;
        }
        if (response.status === 429 || msg.includes('too many') || msg.includes('limite') || msg.includes('cota') || msg.includes('aguarde') || msg.includes('timeout')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
      }
      if (cacheMinutes > 0) {
        const payloadCache = { chave, valor: data, tipo: call, expira_em: new Date(Date.now() + cacheMinutes * 60000).toISOString(), criado_em: new Date().toISOString() };
        const existente = await base44Global.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
        if (existente?.[0]?.id) await base44Global.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payloadCache).catch(() => {}); else await base44Global.asServiceRole.entities.CacheOmieConsulta.create(payloadCache).catch(() => {});
      }
      if (logIntegration) await base44Global.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: data?.faultstring ? 'erro' : 'sucesso', mensagem_erro: data?.faultstring || null, payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
      return data;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error.message;
      if (tentativa < maxRetries) { await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
    }
  }
  return { faultstring: `Falha/timeout ao comunicar com Omie: ${lastError || 'máximo de tentativas excedido'}` };
}

const ESTADO_UF = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO'
};

function somenteDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function texto(valor, limite) {
  const v = String(valor || '').trim();
  return limite ? v.substring(0, limite) : v;
}

function uf(estado) {
  const v = texto(estado);
  if (v.length <= 2) return v.toUpperCase();
  const chave = v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ESTADO_UF[chave] || v.substring(0, 2).toUpperCase();
}

function normalizarCidade(cidade) {
  const original = texto(cidade, 60);
  const chave = original.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const correcoes = {
    'LAGOA DO CAROO': 'LAGOA DO CARRO'
  };
  return correcoes[chave] || original;
}

function telefonePartes(valor) {
  const d = somenteDigitos(valor);
  if (d.length < 10) return { ddd: '', numero: '' };
  return { ddd: d.substring(0, 2), numero: d.substring(2, 20) };
}

function ieCliente(cliente, isPF) {
  const raw = texto(cliente.inscricao_estadual);
  const digitos = somenteDigitos(raw);
  const invalida = !digitos || /^isent/i.test(raw) || digitos.length < 2 || /^(\d)\1+$/.test(digitos);
  if (isPF) return { contribuinte: 'N', inscricao_estadual: '' };
  if (invalida) return { contribuinte: 'N', inscricao_estadual: 'ISENTO' };
  return { contribuinte: 'S', inscricao_estadual: digitos.substring(0, 20) };
}

function validarDocumento(doc) {
  const d = somenteDigitos(doc);
  if (d.length !== 11 && d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  return true;
}

function limparVazios(obj) {
  const obrigatorios = new Set(['codigo_cliente_integracao', 'razao_social', 'nome_fantasia', 'cnpj_cpf', 'pessoa_fisica', 'contribuinte', 'inativo']);
  for (const [key, value] of Object.entries(obj)) {
    if (obrigatorios.has(key)) continue;
    if (value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete obj[key];
    }
  }
  return obj;
}

function mapearClienteOmie(clienteOriginal) {
  const cliente = { ...(clienteOriginal.data || {}), ...clienteOriginal, id: clienteOriginal.id };
  const doc = somenteDigitos(cliente.cnpj_cpf || cliente.cpf_cnpj);
  const isPF = doc.length === 11;
  const tel1 = telefonePartes(cliente.telefone || cliente.whatsapp);
  const tel2 = telefonePartes(cliente.telefone_2);
  const fiscal = ieCliente(cliente, isPF);
  const observacoes = [
    cliente.codigo_interno ? `Código interno: ${cliente.codigo_interno}` : '',
    cliente.codigo_integracao ? `Código integração: ${cliente.codigo_integracao}` : '',
    cliente.cnae ? `CNAE: ${cliente.cnae}` : '',
    cliente.observacoes_logistica ? `Logística: ${cliente.observacoes_logistica}` : '',
    cliente.observacoes ? texto(cliente.observacoes) : '',
    cliente.motivo_bloqueio ? `Bloqueio: ${cliente.motivo_bloqueio}` : ''
  ].filter(Boolean).join(' | ');

  const tags = Array.isArray(cliente.tags)
    ? cliente.tags
        .filter(Boolean)
        .filter(tag => {
          const tagUpper = String(tag).toUpperCase();
          return !tagUpper.startsWith('CODIGO_CLIENTE:') && !tagUpper.startsWith('ROTA:');
        })
        .map(tag => ({ tag: texto(tag, 60) }))
    : [];
  const codigoCliente = cliente.codigo || cliente.codigo_interno || cliente.codigo_integracao;
  const rotaCliente = cliente.rota_nome || cliente.rota || '';
  const tagsUnicas = Array.from(new Map(tags.filter(t => t.tag).map(t => [String(t.tag).toUpperCase(), t])).values());

  const caracteristicas = [
    codigoCliente ? { campo: 'Código', conteudo: texto(codigoCliente, 60) } : null,
    rotaCliente ? { campo: 'Rotas', conteudo: texto(rotaCliente, 60) } : null,
    cliente.rota_id ? { campo: 'Rota ID', conteudo: texto(cliente.rota_id, 60) } : null,
    cliente.vendedor_id ? { campo: 'Vendedor ID', conteudo: texto(cliente.vendedor_id, 60) } : null,
    cliente.supervisor_id ? { campo: 'Supervisor ID', conteudo: texto(cliente.supervisor_id, 60) } : null,
    cliente.motorista_id ? { campo: 'Motorista ID', conteudo: texto(cliente.motorista_id, 60) } : null,
    cliente.segmento_id ? { campo: 'Segmento ID', conteudo: texto(cliente.segmento_id, 60) } : null,
    cliente.rede_id ? { campo: 'Rede ID', conteudo: texto(cliente.rede_id, 60) } : null,
    cliente.tabela_id ? { campo: 'Tabela ID', conteudo: texto(cliente.tabela_id, 60) } : null,
    cliente.plano_pagamento_id ? { campo: 'Plano ID', conteudo: texto(cliente.plano_pagamento_id, 60) } : null
  ].filter(Boolean);

  return limparVazios({
    codigo_cliente_integracao: texto(cliente.codigo || cliente.codigo_interno || cliente.id, 60),
    razao_social: texto(cliente.razao_social || cliente.nome_fantasia || 'Cliente sem nome', 60),
    nome_fantasia: texto(cliente.nome_fantasia || cliente.razao_social || 'Cliente sem nome', 100),
    cnpj_cpf: doc,
    pessoa_fisica: isPF ? 'S' : 'N',
    contato: texto(cliente.contato_nome || cliente.nome_fantasia || cliente.razao_social, 100),
    email: texto(cliente.email_nfe || cliente.email || 'nfe@paoemel.com.br', 500),
    homepage: texto(cliente.site, 100),
    telefone1_ddd: tel1.ddd,
    telefone1_numero: tel1.numero,
    telefone2_ddd: tel2.ddd,
    telefone2_numero: tel2.numero,
    endereco: texto(cliente.endereco, 60),
    endereco_numero: texto(cliente.numero || 'S/N', 10),
    complemento: texto(cliente.complemento, 60),
    bairro: texto(cliente.bairro, 60),
    cidade: normalizarCidade(cliente.cidade),
    estado: uf(cliente.estado),
    cep: somenteDigitos(cliente.cep).substring(0, 8),
    contribuinte: fiscal.contribuinte,
    inscricao_estadual: fiscal.inscricao_estadual,
    inscricao_municipal: texto(cliente.inscricao_municipal, 20),
    inativo: cliente.status === 'inativo' ? 'S' : 'N',
    bloquear_faturamento: cliente.bloquear_faturamento ? 'S' : 'N',
    observacao: texto(observacoes, 500),
    tags: tagsUnicas,
    caracteristicas
  });
}

async function chamarOmie(call, param) {
  return await omieCall(call, param, { cacheMinutes: 15 });
}

async function incluirIndividual(payload, cliente) {
  const retorno = await chamarOmie('IncluirCliente', payload);
  const erro = String(retorno.faultstring || '');
  if (erro) {
    const duplicado = erro.toLowerCase().includes('já cadastrado') || erro.toLowerCase().includes('ja cadastrado') || erro.toLowerCase().includes('already');
    return duplicado ? montarSucesso(cliente, { mensagem: 'Cliente já existia no Omie' }) : montarErro(cliente, erro);
  }
  return montarSucesso(cliente, retorno);
}

async function processarLoteComFallback(lote, clientePorCodigo) {
  const retorno = await chamarOmie('IncluirClientesPorLote', { lote: 1, clientes_cadastro: lote });
  const textoErro = String(retorno.faultstring || '');

  // O Omie pode retornar uma faultstring misturando erro + vários "Cliente cadastrado com sucesso".
  // Quando isso acontece, o único jeito seguro é reprocessar individualmente só esse lote para obter resultado por cliente.
  if (textoErro) {
    const resultados = [];
    for (const payload of lote) {
      const cliente = clientePorCodigo.get(payload.codigo_cliente_integracao) || {};
      resultados.push(await incluirIndividual(payload, cliente));
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
    base44Global = base44;
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
      const resultadosLote = await processarLoteComFallback(lote, clientePorCodigo);
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