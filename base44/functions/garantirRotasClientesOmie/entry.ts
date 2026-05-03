import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_CARACT_URL = 'https://app.omie.com.br/api/v1/geral/clientescaract/';
const OMIE_DELAY_MS = 1700;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const normalizeText = (value) => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
const onlyDigits = (value) => String(value || '').replace(/\D/g, '');
const isRateLimit = (text) => normalizeText(text).includes('rate limit') || normalizeText(text).includes('consumo indevido') || normalizeText(text).includes('limite');

function montarIdentificadores(cliente) {
  const ids = [];
  const codigoOmie = onlyDigits(cliente.codigo_omie);
  if (codigoOmie) ids.push({ codigo_cliente_omie: Number(codigoOmie), origem: 'codigo_omie' });
  if (cliente.codigo_integracao) ids.push({ codigo_cliente_integracao: String(cliente.codigo_integracao), origem: 'codigo_integracao' });
  if (cliente.codigo_interno) ids.push({ codigo_cliente_integracao: String(cliente.codigo_interno), origem: 'codigo_interno' });
  return ids;
}

async function chamarOmie(call, param) {
  const response = await fetch(OMIE_CARACT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { faultstring: text }; }
  if (!response.ok || data.faultstring) throw new Error(data.faultstring || text || `Erro Omie ${response.status}`);
  return data;
}

async function upsertRotaOmie(cliente, rotaNome) {
  const identificadores = montarIdentificadores(cliente);
  let ultimoErro = 'Cliente sem código Omie/integração/interno.';

  for (const identificador of identificadores) {
    const payload = { ...identificador, campo: 'Rotas', conteudo: rotaNome };
    delete payload.origem;

    for (let tentativa = 1; tentativa <= 4; tentativa++) {
      try {
        await chamarOmie('AlterarCaractCliente', payload);
        return { sucesso: true, metodo: 'alterar', origem: identificador.origem };
      } catch (error) {
        const mensagem = error.message || '';
        ultimoErro = mensagem;

        if (isRateLimit(mensagem)) {
          await delay(OMIE_DELAY_MS * tentativa);
          continue;
        }

        const naoExiste = normalizeText(mensagem).includes('nao encontr') || normalizeText(mensagem).includes('não encontr');
        if (!naoExiste) break;

        await delay(OMIE_DELAY_MS);
        try {
          await chamarOmie('IncluirCaractCliente', payload);
          return { sucesso: true, metodo: 'incluir', origem: identificador.origem };
        } catch (inclError) {
          ultimoErro = inclError.message || mensagem;
          if (isRateLimit(ultimoErro)) await delay(OMIE_DELAY_MS * tentativa);
        }
      }
    }

    await delay(OMIE_DELAY_MS);
  }

  return { sucesso: false, erro: ultimoErro };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
      return Response.json({ error: 'Credenciais do Omie não configuradas.' }, { status: 500 });
    }

    const body = await req.json();
    const { dryRun = true, limit = 40, skip = 0, cliente_ids = [] } = body;

    const [clientes, rotas] = await Promise.all([
      base44.asServiceRole.entities.Cliente.list('-created_date', 10000),
      base44.asServiceRole.entities.Rota.list('-created_date', 10000)
    ]);

    const rotasPorId = new Map(rotas.map(rota => [rota.id, rota]));
    const idsFiltro = new Set(Array.isArray(cliente_ids) ? cliente_ids : []);
    const elegiveis = clientes
      .filter(cliente => cliente.status !== 'inativo')
      .filter(cliente => !idsFiltro.size || idsFiltro.has(cliente.id))
      .map(cliente => {
        const rota = rotasPorId.get(cliente.rota_id);
        return rota?.nome ? { cliente, rota_nome: rota.nome } : null;
      })
      .filter(Boolean);

    const lote = elegiveis.slice(Number(skip) || 0, (Number(skip) || 0) + Math.min(Number(limit) || 40, 80));

    if (dryRun) {
      return Response.json({
        dryRun: true,
        total_clientes: clientes.length,
        total_com_rota_para_garantir: elegiveis.length,
        skip: Number(skip) || 0,
        limit: Math.min(Number(limit) || 40, 80),
        lote: lote.map(({ cliente, rota_nome }) => ({
          id: cliente.id,
          codigo_omie: cliente.codigo_omie || '',
          codigo_integracao: cliente.codigo_integracao || '',
          codigo_interno: cliente.codigo_interno || '',
          nome: cliente.nome_fantasia || cliente.razao_social || '',
          rota_nome
        }))
      });
    }

    const resultados = [];
    let sucesso = 0;
    let erros = 0;

    for (const item of lote) {
      const res = await upsertRotaOmie(item.cliente, item.rota_nome);
      if (res.sucesso) sucesso++; else erros++;
      resultados.push({
        cliente_id: item.cliente.id,
        nome: item.cliente.nome_fantasia || item.cliente.razao_social || '',
        rota_nome: item.rota_nome,
        ...res
      });
      await delay(OMIE_DELAY_MS);
    }

    return Response.json({
      dryRun: false,
      total_com_rota_para_garantir: elegiveis.length,
      processados: lote.length,
      sucesso,
      erros,
      proximo_skip: (Number(skip) || 0) + lote.length,
      concluido: (Number(skip) || 0) + lote.length >= elegiveis.length,
      resultados
    });
  } catch (error) {
    console.error('[garantirRotasClientesOmie] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});