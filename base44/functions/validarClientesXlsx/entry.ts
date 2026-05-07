import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import * as XLSX from 'npm:xlsx@0.18.5';

const REQUIRED_COLUMNS = [
  'codigo', 'razao_social', 'nome_fantasia', 'cpf_cnpj', 'inscricao_estadual',
  'plano_pagamento', 'tabela_preco', 'segmento', 'rede', 'vendedor', 'rota',
  'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep', 'latitude',
  'longitude', 'status', 'modalidade'
];

const STATUS_MAP = { ativo: 'ativo', inativo: 'inativo', prospecto: 'prospecto', bloqueado: 'bloqueado' };
const MODALIDADE_MAP = { '55': '55', d1: 'D1' };

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

function normalizeStatus(value) {
  return STATUS_MAP[normalizeKey(value)] || null;
}

function normalizeModalidade(value) {
  return MODALIDADE_MAP[normalizeKey(value)] || MODALIDADE_MAP[String(value ?? '').trim().toLowerCase()] || null;
}

function normalizeUF(value) {
  const raw = normalizeText(value).toUpperCase();
  if (!raw) return '';
  if (raw.length === 2) return raw;
  return UF_MAP[raw.replace(/\s+/g, '_')] || raw;
}

function normalizeCoord(value, type) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num === 0) return null;

  let coord = num;
  while (Math.abs(coord) > 180) coord = coord / 10;

  if (type === 'lat' && (coord < -90 || coord > 90)) return null;
  if (type === 'lng' && (coord < -180 || coord > 180)) return null;
  return Number(coord.toFixed(8));
}

function makeMap(items) {
  const map = new Map();
  for (const item of items) {
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

function rowToCliente(row, maps) {
  return {
    codigo_interno: String(row.codigo ?? '').trim(),
    codigo_integracao: String(row.codigo ?? '').trim(),
    razao_social: normalizeText(row.razao_social),
    nome_fantasia: normalizeText(row.nome_fantasia),
    cnpj_cpf: onlyDigits(row.cpf_cnpj),
    inscricao_estadual: onlyDigits(row.inscricao_estadual) || normalizeText(row.inscricao_estadual),
    plano_pagamento_id: findLookupId(row.plano_pagamento, maps.planos),
    tabela_id: findLookupId(row.tabela_preco, maps.tabelas),
    segmento_id: findLookupId(row.segmento, maps.segmentos),
    rede_id: findLookupId(row.rede, maps.redes),
    vendedor_id: findLookupId(row.vendedor, maps.vendedores),
    rota_id: findLookupId(row.rota, maps.rotas),
    endereco: normalizeText(row.endereco),
    numero: String(row.numero ?? '').trim(),
    bairro: normalizeText(row.bairro),
    cidade: normalizeText(row.cidade),
    estado: normalizeUF(row.estado),
    cep: onlyDigits(row.cep).padStart(8, '0').slice(0, 8),
    latitude: normalizeCoord(row.latitude, 'lat'),
    longitude: normalizeCoord(row.longitude, 'lng'),
    status: normalizeStatus(row.status) || 'inativo',
    tipo_nota: normalizeModalidade(row.modalidade) || '55'
  };
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
    if (!response.ok) return Response.json({ error: 'Não foi possível baixar o arquivo.' }, { status: 400 });

    const buffer = await response.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null }).map((row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) normalized[normalizeKey(key)] = value;
      return normalized;
    });

    const columns = rows.length ? Object.keys(rows[0]) : [];
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
    const mappedPreview = [];

    rows.forEach((row, index) => {
      const line = index + 2;
      const errors = [];
      const codigo = String(row.codigo ?? '').trim();
      const doc = onlyDigits(row.cpf_cnpj);

      if (!codigo) errors.push('codigo vazio');
      if (!normalizeText(row.razao_social)) errors.push('razao_social vazia');
      if (!doc) errors.push('cpf_cnpj vazio');
      if (doc && ![11, 14].includes(doc.length)) errors.push('cpf_cnpj com tamanho inválido');
      if (!normalizeStatus(row.status)) errors.push('status inválido');
      if (!normalizeModalidade(row.modalidade)) errors.push('modalidade inválida');
      if (!normalizeUF(row.estado)) errors.push('estado vazio/inválido');
      if (!onlyDigits(row.cep)) errors.push('cep vazio');

      if (codigo) {
        if (seenCodes.has(codigo)) duplicates.codigos.push({ linha: line, codigo });
        seenCodes.add(codigo);
      }
      if (doc) {
        if (seenDocs.has(doc)) duplicates.documentos.push({ linha: line, cpf_cnpj: doc });
        seenDocs.add(doc);
      }

      if (row.plano_pagamento && !findLookupId(row.plano_pagamento, maps.planos)) missingLookups.planos.add(normalizeText(row.plano_pagamento));
      if (row.tabela_preco && !findLookupId(row.tabela_preco, maps.tabelas)) missingLookups.tabelas.add(normalizeText(row.tabela_preco));
      if (row.segmento && !findLookupId(row.segmento, maps.segmentos)) missingLookups.segmentos.add(normalizeText(row.segmento));
      if (row.rede && !findLookupId(row.rede, maps.redes)) missingLookups.redes.add(normalizeText(row.rede));
      if (row.vendedor && !findLookupId(row.vendedor, maps.vendedores)) missingLookups.vendedores.add(normalizeText(row.vendedor));
      if (row.rota && !findLookupId(row.rota, maps.rotas)) missingLookups.rotas.add(normalizeText(row.rota));

      if (errors.length) invalidRows.push({ linha: line, codigo, razao_social: row.razao_social, erros: errors });
      if (mappedPreview.length < 5) mappedPreview.push(rowToCliente(row, maps));
    });

    const missingLookupsOutput = Object.fromEntries(
      Object.entries(missingLookups).map(([key, value]) => [key, [...value].sort()])
    );

    const totalMissingLookups = Object.values(missingLookupsOutput).reduce((sum, arr) => sum + arr.length, 0);
    const totalDuplicateRows = duplicates.codigos.length + duplicates.documentos.length;
    const aprovadoParaImportar = missingColumns.length === 0 && invalidRows.length === 0 && totalDuplicateRows === 0 && totalMissingLookups === 0;

    return Response.json({
      sucesso: true,
      sheet: sheetName,
      linhas: rows.length,
      colunas: columns,
      colunas_esperadas: REQUIRED_COLUMNS,
      colunas_faltantes: missingColumns,
      linhas_invalidas: invalidRows.length,
      amostras_invalidas: invalidRows.slice(0, 30),
      duplicados: duplicates,
      referencias_nao_encontradas: missingLookupsOutput,
      preview_mapeado: mappedPreview,
      aprovado_para_importar: aprovadoParaImportar,
      recomendacao: aprovadoParaImportar
        ? 'Arquivo aprovado para importação em massa.'
        : 'Corrija colunas, duplicidades, campos inválidos ou cadastros de referência antes da importação.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});