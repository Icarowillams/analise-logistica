import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const normalizeText = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ');

const onlyDigits = (value) => String(value || '').replace(/\D/g, '');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isRateLimitError = (error) => {
  const message = String(error?.message || error?.response?.data?.error || error?.response?.data?.detail || '').toLowerCase();
  return message.includes('rate limit') || message.includes('429');
};

async function bulkAtualizarClientesComRetry(base44, itens) {
  const updates = itens.map(item => ({ id: item.id, ...item.patch }));

  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    try {
      return await base44.asServiceRole.entities.Cliente.bulkUpdate(updates);
    } catch (error) {
      if (!isRateLimitError(error) || tentativa === 5) throw error;
      await delay(2500 * tentativa);
    }
  }
}

const normalizeStatus = (value) => {
  const text = normalizeText(value);
  if (text === 'ativo' || text === 'actived' || text === 'active') return 'ativo';
  if (text === 'inativo' || text === 'inactive') return 'inativo';
  if (text === 'prospecto' || text === 'prospect') return 'prospecto';
  if (text === 'bloqueado') return 'bloqueado';
  return null;
};

const normalizeRouteName = (value) => normalizeText(value)
  .replace(/\s*-\s*/g, ' - ')
  .replace(/\s+/g, ' ')
  .trim();

const parseCsvLine = (line) => {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ';' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  out.push(current.trim());
  return out;
};

const parseCsv = (text) => {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => normalizeText(h).replace(/[^a-z0-9_]/g, ''));
  return lines.slice(1).map((line, index) => {
    const cols = parseCsvLine(line);
    const row = { linha: index + 2 };
    headers.forEach((header, i) => {
      row[header] = cols[i] || '';
    });
    return row;
  });
};

const addToMap = (map, key, cliente) => {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(cliente);
};

const uniqueById = (items) => {
  const seen = new Map();
  items.filter(Boolean).forEach(item => seen.set(item.id, item));
  return [...seen.values()];
};

const getClienteCodes = (cliente) => [
  onlyDigits(cliente.codigo_interno),
  onlyDigits(cliente.codigo_integracao),
  onlyDigits(cliente.codigo_omie)
].filter(Boolean);

const scoreCliente = (cliente, entrada) => {
  const codes = getClienteCodes(cliente);
  const doc = onlyDigits(cliente.cnpj_cpf);
  const fantasia = normalizeText(cliente.nome_fantasia);
  const razao = normalizeText(cliente.razao_social);

  let score = 0;
  if (entrada.codigoDigits && codes.includes(entrada.codigoDigits)) score += 100;
  if (entrada.documentoDigits && doc === entrada.documentoDigits) score += 120;
  if (entrada.nomeNorm && fantasia === entrada.nomeNorm) score += 35;
  if (entrada.razaoNorm && razao === entrada.razaoNorm) score += 35;
  if (entrada.nomeNorm && razao === entrada.nomeNorm) score += 20;
  if (entrada.razaoNorm && fantasia === entrada.razaoNorm) score += 20;
  if (entrada.status && cliente.status === entrada.status) score += 25;
  return score;
};

const resolverCliente = ({ porCodigo, porDocumento, porNome, entrada }) => {
  const candidatos = uniqueById([
    ...(porCodigo.get(entrada.codigoDigits) || []),
    ...(porDocumento.get(entrada.documentoDigits) || []),
    ...(porDocumento.get(entrada.codigoDigits) || []),
    ...(porNome.get(entrada.nomeNorm) || []),
    ...(porNome.get(entrada.razaoNorm) || [])
  ]);

  if (candidatos.length === 0) return { cliente: null, candidatos: [] };

  const ranqueados = candidatos
    .map(cliente => ({ cliente, score: scoreCliente(cliente, entrada) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranqueados.length === 0) return { cliente: null, candidatos };
  if (ranqueados.length === 1 || ranqueados[0].score > ranqueados[1].score) {
    return { cliente: ranqueados[0].cliente, candidatos: [] };
  }

  return { cliente: null, candidatos: ranqueados.filter(item => item.score === ranqueados[0].score).map(item => item.cliente) };
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const body = await req.json();
    const { file_url, csv_text, dryRun = true, updateOffset = 0, updateLimit = 200 } = body;

    if (!file_url && !csv_text) {
      return Response.json({ error: 'Envie um arquivo CSV.' }, { status: 400 });
    }

    let csvText = csv_text || '';
    if (!csvText && file_url) {
      const fileRes = await fetch(file_url);
      if (!fileRes.ok) {
        return Response.json({ error: 'Não foi possível ler o CSV enviado.' }, { status: 400 });
      }
      csvText = await fileRes.text();
    }
    const linhas = parseCsv(csvText);

    const clientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
    let rotas = await base44.asServiceRole.entities.Rota.list('-created_date', 10000);

    const porCodigo = new Map();
    const porDocumento = new Map();
    const porNome = new Map();

    clientes.forEach(cliente => {
      addToMap(porCodigo, onlyDigits(cliente.codigo_interno), cliente);
      addToMap(porCodigo, onlyDigits(cliente.codigo_integracao), cliente);
      addToMap(porCodigo, onlyDigits(cliente.codigo_omie), cliente);
      addToMap(porDocumento, onlyDigits(cliente.cnpj_cpf), cliente);
      addToMap(porNome, normalizeText(cliente.nome_fantasia), cliente);
      addToMap(porNome, normalizeText(cliente.razao_social), cliente);
    });

    const rotaPorNome = new Map(rotas.map(rota => [normalizeRouteName(rota.nome), rota]));
    const rotasCriadas = [];
    const atualizacoes = [];
    const naoEncontrados = [];
    const ambiguos = [];
    const semAlteracao = [];

    for (const linha of linhas) {
      const codigo = linha.codigo || linha.cod || linha.codigocliente || '';
      const nome = linha.nome_fantasia || linha.nomefantasia || linha.nome || '';
      const razaoSocial = linha.razao_social || linha.razaosocial || '';
      const documento = linha.cnpj_cpf || linha.cpf_cnpj || linha.cnpjcpf || linha.cpfcnpj || '';
      const rotaNome = String(linha.rota || '').trim();
      const status = normalizeStatus(linha.status);
      const entrada = {
        codigoDigits: onlyDigits(codigo),
        documentoDigits: onlyDigits(documento),
        nomeNorm: normalizeText(nome),
        razaoNorm: normalizeText(razaoSocial),
        status
      };

      const resolucao = resolverCliente({ porCodigo, porDocumento, porNome, entrada });
      const cliente = resolucao.cliente;

      if (!cliente) {
        if (resolucao.candidatos.length > 1) {
          ambiguos.push({
            linha: linha.linha,
            codigo,
            cnpj_cpf: documento,
            nome,
            razao_social: razaoSocial,
            rota: rotaNome,
            candidatos: resolucao.candidatos.map(c => ({ id: c.id, codigo: c.codigo_interno || c.codigo_integracao || c.codigo_omie || '', cnpj_cpf: c.cnpj_cpf || '', nome: c.nome_fantasia || c.razao_social || '', status: c.status || '', rota_id: c.rota_id || '', updated_date: c.updated_date || '' }))
          });
        } else {
          naoEncontrados.push({ linha: linha.linha, codigo, cnpj_cpf: documento, nome, razao_social: razaoSocial, rota: rotaNome, status: linha.status });
        }
        continue;
      }

      let rota = rotaNome ? rotaPorNome.get(normalizeRouteName(rotaNome)) : null;
      if (rotaNome && !rota && !dryRun) {
        rota = await base44.asServiceRole.entities.Rota.create({ nome: rotaNome, status: 'ativo', clientes_ids: [] });
        rotaPorNome.set(normalizeRouteName(rotaNome), rota);
        rotasCriadas.push({ id: rota.id, nome: rotaNome });
      } else if (rotaNome && !rota) {
        rota = { id: '__nova__', nome: rotaNome };
      }

      const patch = {};
      if (rotaNome && rota?.id && cliente.rota_id !== rota.id) patch.rota_id = rota.id;
      if (status && cliente.status !== status) patch.status = status;

      if (Object.keys(patch).length === 0) {
        semAlteracao.push({ id: cliente.id, codigo, nome: cliente.nome_fantasia || cliente.razao_social });
        continue;
      }

      atualizacoes.push({
        id: cliente.id,
        codigo,
        nome: cliente.nome_fantasia || cliente.razao_social || nome,
        rota_atual: cliente.rota_id || '',
        rota_nova: rotaNome,
        status_atual: cliente.status || '',
        status_novo: status || '',
        patch
      });
    }

    const loteAtualizacoes = dryRun ? [] : atualizacoes.slice(updateOffset, updateOffset + updateLimit);

    if (!dryRun && loteAtualizacoes.length > 0) {
      await bulkAtualizarClientesComRetry(base44, loteAtualizacoes);
    }

    const processadoAte = dryRun ? 0 : Math.min(updateOffset + loteAtualizacoes.length, atualizacoes.length);

    return Response.json({
      dryRun,
      total_linhas_csv: linhas.length,
      clientes_base44: clientes.length,
      atualizacoes: atualizacoes.length,
      atualizadas_agora: loteAtualizacoes.length,
      processado_ate: processadoAte,
      pendentes: dryRun ? atualizacoes.length : Math.max(atualizacoes.length - processadoAte, 0),
      concluido: dryRun || processadoAte >= atualizacoes.length,
      sem_alteracao: semAlteracao.length,
      nao_encontrados: naoEncontrados.length,
      ambiguos: ambiguos.length,
      rotas_criadas: rotasCriadas.length,
      amostras: {
        ambiguos: ambiguos.slice(0, 10),
        nao_encontrados: naoEncontrados.slice(0, 20),
        atualizacoes: atualizacoes.slice(0, 20),
        rotas_criadas: rotasCriadas.slice(0, 20)
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});