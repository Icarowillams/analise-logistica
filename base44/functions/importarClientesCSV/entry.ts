import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const STATUS_MAP = {
  'ATIVO': 'ativo', 'INATIVO': 'inativo', 'PROSPECTO': 'prospecto', 'BLOQUEADO': 'bloqueado',
};

const ESTADO_MAP = {
  'PERNAMBUCO': 'PE', 'PARAIBA': 'PB', 'ALAGOAS': 'AL', 'BAHIA': 'BA',
  'CEARA': 'CE', 'MARANHAO': 'MA', 'PIAUI': 'PI', 'RIO GRANDE DO NORTE': 'RN',
  'SERGIPE': 'SE', 'TOCANTINS': 'TO', 'PARA': 'PA', 'GOIAS': 'GO',
  'SAO PAULO': 'SP', 'RIO DE JANEIRO': 'RJ', 'MINAS GERAIS': 'MG',
};

function normalizeUF(uf) {
  if (!uf) return '';
  const u = uf.trim().toUpperCase();
  if (u.length === 2) return u;
  return ESTADO_MAP[u] || u;
}

function parseCoord(val) {
  if (!val || val.trim() === '' || val.includes('E+00') || val === '0') return null;
  const cleaned = val.replace(',', '.').replace(/[^\d.\-]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num === 0) return null;
  if (Math.abs(num) > 1000) return num / 1e8;
  if (Math.abs(num) > 90) return num / 100;
  return num;
}

function cleanCell(value) {
  const v = String(value || '').trim().replace(/^\uFEFF/, '');
  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/""/g, '"').trim();
  }
  return v;
}

function parseLine(line) {
  const parts = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ';' && !inQuotes) {
      parts.push(cleanCell(cur));
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cleanCell(cur));
  return parts;
}

function normalize(str) {
  return (str || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findId(list, name, field = 'nome') {
  if (!name || name.trim() === '') return undefined;
  const n = normalize(name);
  const found = list.find(item => normalize(item[field]) === n);
  return found?.id || undefined;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  const body = await req.json();
  const { fileUrl, startOffset = 0 } = body;
  if (!fileUrl) return Response.json({ error: 'fileUrl required' }, { status: 400 });

  // Carregar entidades de referência para lookup
  const [vendedores, rotas, segmentos, tabelas, redes] = await Promise.all([
    base44.asServiceRole.entities.Vendedor.list('nome', 500),
    base44.asServiceRole.entities.Rota.list('nome', 500),
    base44.asServiceRole.entities.Segmento.list('nome', 500),
    base44.asServiceRole.entities.TabelaPreco.list('nome', 500),
    base44.asServiceRole.entities.Rede.list('nome', 500),
  ]);

  // Fetch CSV
  const resp = await fetch(fileUrl);
  const buffer = await resp.arrayBuffer();
  const text = new TextDecoder('windows-1252').decode(buffer);

  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const dataLines = lines.slice(1); // skip header

  const results = { success: 0, errors: [], total: dataLines.length };
  const BATCH = 25;

  for (let i = startOffset; i < dataLines.length; i += BATCH) {
    const batch = dataLines.slice(i, i + BATCH);
    const records = [];

    for (const line of batch) {
      const p = parseLine(line.trim());
      if (p.length < 10) continue;

      const [
        codigo, razao_social, fantasia, cpf_cnpj, ie,
        plano_pag, tabela, segmento, rede, vendedor, rota,
        endereco, numero, bairro, cidade, uf, cep, lat, lng, status
      ] = p;

      if (!razao_social || razao_social.trim() === '') continue;

      const cnpj_cpf = (cpf_cnpj || '').replace(/\D/g, '');

      records.push({
        codigo_interno: (codigo || '').trim() || undefined,
        codigo_integracao: (codigo || '').trim() || undefined,
        razao_social: (razao_social || '').trim(),
        nome_fantasia: (fantasia || '').trim() || undefined,
        cnpj_cpf: cnpj_cpf || undefined,
        inscricao_estadual: (ie || '').trim() || undefined,
        endereco: (endereco || '').trim() || undefined,
        bairro: (bairro || '').trim() || undefined,
        numero: (numero || '').trim() || undefined,
        cep: (cep || '').replace(/\D/g, '') || undefined,
        cidade: (cidade || '').trim() || undefined,
        estado: normalizeUF(uf) || undefined,
        latitude: parseCoord(lat) || undefined,
        longitude: parseCoord(lng) || undefined,
        status: STATUS_MAP[(status || '').trim().toUpperCase()] || 'inativo',
        // Vínculos por ID
        vendedor_id: findId(vendedores, vendedor) || undefined,
        rota_id: findId(rotas, rota) || undefined,
        segmento_id: findId(segmentos, segmento) || undefined,
        tabela_id: findId(tabelas, tabela) || undefined,
        rede_id: findId(redes, rede) || undefined,
        tags: [
          codigo ? `CODIGO_CLIENTE:${codigo.trim()}` : '',
          rota ? `ROTA:${rota.trim()}` : '',
        ].filter(Boolean),
        observacoes: [
          plano_pag ? `Plano: ${(plano_pag||'').trim()}` : '',
        ].filter(Boolean).join(' | ') || undefined,
      });
    }

    if (records.length === 0) continue;

    let ok = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await base44.asServiceRole.entities.Cliente.bulkCreate(records);
        results.success += records.length;
        ok = true;
        break;
      } catch (err) {
        if (err.message?.includes('Rate limit') || err.message?.includes('429')) {
          await sleep(4000 * (attempt + 1));
        } else {
          results.errors.push(`Batch ${i}: ${err.message}`);
          break;
        }
      }
    }
    if (!ok && !results.errors.find(e => e.startsWith(`Batch ${i}`))) {
      results.errors.push(`Batch ${i}: Rate limit persistente`);
    }

    await sleep(300);
  }

  return Response.json(results);
});