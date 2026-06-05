import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = 'https://app.omie.com.br/api/v1/geral/clientes/';
const TAMANHO_LOTE_OMIE = 50;

// ✅ omieCall local → wrapper _shared/omieClient
async function omieCall(base44, callOrEndpoint, param, optsOrCall) {
  if (typeof optsOrCall === 'object') return omieCallShared(base44, callOrEndpoint, param, optsOrCall || {});
  if (typeof optsOrCall === 'string') return omieCallShared(base44, callOrEndpoint, param, { call: optsOrCall });
  return omieCallShared(base44, 'geral/clientes/', param, { call: callOrEndpoint });
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