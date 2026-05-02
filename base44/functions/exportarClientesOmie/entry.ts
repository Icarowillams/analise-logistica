import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = 'https://app.omie.com.br/api/v1/geral/clientes/';
const TAMANHO_LOTE_OMIE = 50;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

function mapearClienteOmie(cliente) {
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
  const rotaCliente = cliente.rota_nome || cliente.rota || cliente.rota_id;
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

async function chamarOmie(call, param, tentativa = 0) {
  const response = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
  });
  const data = await response.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const code = String(data.faultcode || '');
    const rate = response.status === 429 || code.includes('425') || code.includes('520') || msg.includes('too many') || msg.includes('limite') || msg.includes('cota') || msg.includes('aguarde');
    if (rate && tentativa < 4) {
      await sleep(2500 * (tentativa + 1));
      return chamarOmie(call, param, tentativa + 1);
    }
  }
  return data;
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
      await sleep(300);
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
    if ((i + 1) % 10 === 0) await sleep(800);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const clientes = Array.isArray(body.clientes_data) ? body.clientes_data : [];
    if (clientes.length === 0) return Response.json({ error: 'Nenhum cliente recebido' }, { status: 400 });

    console.log(`[exportarClientesOmie] Novo exportador em lote: ${clientes.length} clientes`);

    const resultados = [];
    const validos = [];
    const clientePorCodigo = new Map();

    for (const cliente of clientes) {
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
      if (i + TAMANHO_LOTE_OMIE < validos.length) await sleep(1200);
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