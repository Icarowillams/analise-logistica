import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const REQUIRED_COLUMNS = [
  'codigo', 'razao_social', 'nome_fantasia', 'cpf_cnpj', 'inscricao_estadual',
  'plano_pagamento', 'tabela_preco', 'segmento', 'rede', 'vendedor', 'rota',
  'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep', 'latitude',
  'longitude', 'status', 'modalidade'
];

const UF_MAP = {
  ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE',
  DISTRITO_FEDERAL: 'DF', ESPIRITO_SANTO: 'ES', GOIAS: 'GO', MARANHAO: 'MA',
  MATO_GROSSO: 'MT', MATO_GROSSO_DO_SUL: 'MS', MINAS_GERAIS: 'MG', PARA: 'PA',
  PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI', RIO_DE_JANEIRO: 'RJ',
  RIO_GRANDE_DO_NORTE: 'RN', RIO_GRANDE_DO_SUL: 'RS', RONDONIA: 'RO', RORAIMA: 'RR',
  SANTA_CATARINA: 'SC', SAO_PAULO: 'SP', SERGIPE: 'SE', TOCANTINS: 'TO'
};

const normalizeText = (value) => String(value ?? '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ');

const normalizeKey = (value) => normalizeText(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const normalizeLookup = (value) => normalizeText(value).toUpperCase();
const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

function parseCsvLine(line) {
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
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return { columns: [], rows: [] };
  const columns = parseCsvLine(lines[0]).map(normalizeKey);
  const rows = lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row = { __linha: index + 2, __colunas: values.length };
    columns.forEach((col, i) => row[col] = values[i] ?? '');
    return row;
  });
  return { columns, rows };
}

function normalizeStatus(value) {
  const status = normalizeKey(value);
  if (['ativo', 'inativo', 'prospecto', 'bloqueado'].includes(status)) return status;
  return null;
}

function normalizeModalidade(value) {
  const modalidade = normalizeKey(value).toUpperCase();
  if (modalidade === '55') return '55';
  if (modalidade === 'D1') return 'D1';
  return null;
}

function normalizeUF(value) {
  const raw = normalizeText(value).toUpperCase();
  if (!raw) return '';
  if (raw.length === 2) return raw;
  return UF_MAP[raw.replace(/\s+/g, '_')] || '';
}

function normalizeCoord(value, type) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  let coord = Number(raw);
  if (!Number.isFinite(coord) || coord === 0) return null;
  while (Math.abs(coord) > 180) coord = coord / 10;
  if (type === 'lat' && (coord < -90 || coord > 90)) return null;
  if (type === 'lng' && (coord < -180 || coord > 180)) return null;
  return Number(coord.toFixed(8));
}

function makeMap(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = normalizeLookup(item.nome);
    if (key) map.set(key, item.id);
  }
  return map;
}

function findLookupId(value, map) {
  const key = normalizeLookup(value);
  if (!key) return '';
  return map.get(key) || '';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
    }

    const { fileUrl } = await req.json();
    if (!fileUrl) return Response.json({ error: 'fileUrl obrigatório.' }, { status: 400 });

    const response = await fetch(fileUrl);
    if (!response.ok) return Response.json({ error: 'Não foi possível baixar o CSV.' }, { status: 400 });

    const csvText = await response.text();
    const { columns, rows } = parseCsv(csvText);
    const missingColumns = REQUIRED_COLUMNS.filter(col => !columns.includes(col));

    const [planos, tabelas, segmentos, redes, vendedores, rotas] = await Promise.all([
      base44.asServiceRole.entities.PlanoPagamento.list('nome', 1000),
      base44.asServiceRole.entities.TabelaPreco.list('nome', 1000),
      base44.asServiceRole.entities.Segmento.list('nome', 1000),
      base44.asServiceRole.entities.Rede.list('nome', 1000),
      base44.asServiceRole.entities.Vendedor.list('nome', 1000),
      base44.asServiceRole.entities.Rota.list('nome', 1000),
    ]);

    const maps = {
      planos: makeMap(planos),
      tabelas: makeMap(tabelas),
      segmentos: makeMap(segmentos),
      redes: makeMap(redes),
      vendedores: makeMap(vendedores),
      rotas: makeMap(rotas),
    };

    const seenCodes = new Set();
    const seenDocs = new Set();
    const duplicates = { codigos: [], documentos: [] };
    const invalidRows = [];
    const missingLookups = { planos: new Set(), tabelas: new Set(), segmentos: new Set(), redes: new Set(), vendedores: new Set(), rotas: new Set() };
    const coordWarnings = [];

    for (const row of rows) {
      const errors = [];
      const codigo = String(row.codigo ?? '').trim();
      const doc = onlyDigits(row.cpf_cnpj);

      if (row.__colunas !== columns.length) errors.push(`quantidade de colunas diferente (${row.__colunas}/${columns.length})`);
      if (!codigo) errors.push('codigo vazio');
      if (!normalizeText(row.razao_social)) errors.push('razao_social vazia');
      if (!doc) errors.push('cpf_cnpj vazio');
      if (doc && ![11, 14].includes(doc.length)) errors.push('cpf_cnpj com tamanho inválido');
      if (!normalizeStatus(row.status)) errors.push('status inválido');
      if (!normalizeModalidade(row.modalidade)) errors.push('modalidade inválida');
      if (!normalizeUF(row.estado)) errors.push('estado inválido');
      if (!onlyDigits(row.cep)) errors.push('cep vazio');

      if (codigo) {
        if (seenCodes.has(codigo)) duplicates.codigos.push({ linha: row.__linha, codigo });
        seenCodes.add(codigo);
      }
      if (doc) {
        if (seenDocs.has(doc)) duplicates.documentos.push({ linha: row.__linha, cpf_cnpj: doc });
        seenDocs.add(doc);
      }

      if (row.plano_pagamento && !findLookupId(row.plano_pagamento, maps.planos)) missingLookups.planos.add(normalizeText(row.plano_pagamento));
      if (row.tabela_preco && !findLookupId(row.tabela_preco, maps.tabelas)) missingLookups.tabelas.add(normalizeText(row.tabela_preco));
      if (row.segmento && !findLookupId(row.segmento, maps.segmentos)) missingLookups.segmentos.add(normalizeText(row.segmento));
      if (row.rede && !findLookupId(row.rede, maps.redes)) missingLookups.redes.add(normalizeText(row.rede));
      if (row.vendedor && !findLookupId(row.vendedor, maps.vendedores)) missingLookups.vendedores.add(normalizeText(row.vendedor));
      if (row.rota && !findLookupId(row.rota, maps.rotas)) missingLookups.rotas.add(normalizeText(row.rota));

      const lat = normalizeCoord(row.latitude, 'lat');
      const lng = normalizeCoord(row.longitude, 'lng');
      if ((row.latitude || row.longitude) && (lat === null || lng === null)) {
        coordWarnings.push({ linha: row.__linha, codigo, latitude: row.latitude, longitude: row.longitude });
      }

      if (errors.length) invalidRows.push({ linha: row.__linha, codigo, razao_social: row.razao_social, erros: errors });
    }

    const referencias = Object.fromEntries(Object.entries(missingLookups).map(([key, value]) => [key, [...value].sort()]));
    const totalMissingLookups = Object.values(referencias).reduce((sum, arr) => sum + arr.length, 0);
    const totalDuplicados = duplicates.codigos.length + duplicates.documentos.length;
    const aprovado = missingColumns.length === 0 && invalidRows.length === 0 && totalDuplicados === 0 && totalMissingLookups === 0;

    return Response.json({
      sucesso: true,
      linhas: rows.length,
      colunas: columns,
      colunas_faltantes: missingColumns,
      linhas_invalidas: invalidRows.length,
      amostras_invalidas: invalidRows.slice(0, 30),
      duplicados: duplicates,
      referencias_nao_encontradas: referencias,
      coordenadas_com_alerta: coordWarnings.slice(0, 30),
      total_alertas_coordenadas: coordWarnings.length,
      aprovado_para_importar: aprovado,
      recomendacao: aprovado ? 'Arquivo aprovado para importação em massa.' : 'Ainda não importe: corrija referências faltantes, duplicidades ou linhas inválidas primeiro.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});