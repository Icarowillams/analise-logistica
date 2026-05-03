import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const normalizeText = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ');

const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

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

const firstUnique = (map, key) => {
  const found = map.get(key);
  return found?.length === 1 ? found[0] : null;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const body = await req.json();
    const { file_url, dryRun = true } = body;

    if (!file_url) {
      return Response.json({ error: 'Envie um arquivo CSV.' }, { status: 400 });
    }

    const fileRes = await fetch(file_url);
    if (!fileRes.ok) {
      return Response.json({ error: 'Não foi possível ler o CSV enviado.' }, { status: 400 });
    }

    const csvText = await fileRes.text();
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
      const codigoDigits = onlyDigits(codigo);
      const documentoDigits = onlyDigits(documento);

      let cliente = firstUnique(porCodigo, codigoDigits) || firstUnique(porDocumento, documentoDigits) || firstUnique(porDocumento, codigoDigits) || firstUnique(porNome, normalizeText(nome)) || firstUnique(porNome, normalizeText(razaoSocial));

      if (!cliente) {
        const candidatos = [
          ...(porCodigo.get(codigoDigits) || []),
          ...(porDocumento.get(documentoDigits) || []),
          ...(porDocumento.get(codigoDigits) || []),
          ...(porNome.get(normalizeText(nome)) || []),
          ...(porNome.get(normalizeText(razaoSocial)) || [])
        ];

        if (candidatos.length > 1) {
          ambiguos.push({ linha: linha.linha, codigo, nome, rota: rotaNome, candidatos: candidatos.map(c => c.id) });
        } else {
          naoEncontrados.push({ linha: linha.linha, codigo, nome, rota: rotaNome, status: linha.status });
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

    if (!dryRun) {
      const lote = 10;
      for (let i = 0; i < atualizacoes.length; i += lote) {
        await Promise.all(atualizacoes.slice(i, i + lote).map(item => base44.asServiceRole.entities.Cliente.update(item.id, item.patch)));
      }
    }

    return Response.json({
      dryRun,
      total_linhas_csv: linhas.length,
      clientes_base44: clientes.length,
      atualizacoes: atualizacoes.length,
      sem_alteracao: semAlteracao.length,
      nao_encontrados: naoEncontrados.length,
      ambiguos: ambiguos.length,
      rotas_criadas: rotasCriadas.length,
      amostras: {
        atualizacoes: atualizacoes.slice(0, 20),
        nao_encontrados: naoEncontrados.slice(0, 20),
        ambiguos: ambiguos.slice(0, 10),
        rotas_criadas: rotasCriadas.slice(0, 20)
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});