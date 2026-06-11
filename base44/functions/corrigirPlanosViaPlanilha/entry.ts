import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import * as XLSX from 'npm:xlsx@0.18.5';

const normalizeStr = (s) => (s || '').toString().toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lê XLSX/CSV e extrai [{ codigo, plano_pagamento, cobranca }]
// codigo_interno = 1ª coluna (posição), demais por nome de cabeçalho
async function extrairLinhas(file_url) {
  const resp = await fetch(file_url);
  if (!resp.ok) throw new Error(`Falha ao baixar arquivo: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!rows.length) return [];

  const header = rows[0].map((h) => normalizeStr(h));
  const idxPlano = header.findIndex((h) => h === 'PLANO PAGAMENTO' || h === 'PLANO DE PAGAMENTO');
  const idxCobranca = header.findIndex((h) => h === 'COBRANCA');
  if (idxPlano === -1 && idxCobranca === -1) {
    throw new Error('Colunas "PLANO PAGAMENTO" e/ou "COBRANCA" não encontradas no cabeçalho da planilha');
  }

  return rows.slice(1)
    .map((r) => ({
      codigo: String(r[0] ?? '').trim(),
      plano_pagamento: idxPlano >= 0 ? String(r[idxPlano] ?? '').trim() : '',
      cobranca: idxCobranca >= 0 ? String(r[idxCobranca] ?? '').trim() : '',
    }))
    .filter((l) => l.codigo);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { file_url, clientes: clientesPayload, somente_vazios = true } = body || {};

    let linhas;
    if (Array.isArray(clientesPayload) && clientesPayload.length > 0) {
      linhas = clientesPayload.map((c) => ({
        codigo: String(c.codigo ?? '').trim(),
        plano_pagamento: String(c.plano_pagamento ?? '').trim(),
        cobranca: String(c.cobranca ?? '').trim(),
      })).filter((l) => l.codigo);
    } else if (file_url) {
      linhas = await extrairLinhas(file_url);
    } else {
      return Response.json({ error: 'Informe file_url ou clientes[]' }, { status: 400 });
    }

    // De-para de planos e modalidades
    const [planos, modalidades] = await Promise.all([
      base44.entities.PlanoPagamento.list(null, 1000),
      base44.entities.ModalidadePagamento.list(null, 1000),
    ]);
    const planoMap = {};
    for (const p of planos) planoMap[normalizeStr(p.nome)] = p.id;
    const modalidadeMap = {};
    for (const m of modalidades) modalidadeMap[normalizeStr(m.nome)] = m.id;

    const resumo = {
      total_planilha: linhas.length,
      atualizados: 0,
      ja_corretos: 0,
      sem_cliente_no_banco: [],
      nao_mapeados: [],
    };

    let updatesFeitos = 0;
    const LOTE = 10;

    for (let i = 0; i < linhas.length; i += LOTE) {
      const lote = linhas.slice(i, i + LOTE);
      await Promise.all(lote.map(async (linha) => {
        const planoId = linha.plano_pagamento ? planoMap[normalizeStr(linha.plano_pagamento)] : undefined;
        const modalidadeId = linha.cobranca ? modalidadeMap[normalizeStr(linha.cobranca)] : undefined;

        // Nome presente na planilha mas sem correspondência no banco → não inventa
        const planoNaoMapeado = linha.plano_pagamento && !planoId;
        const cobrancaNaoMapeada = linha.cobranca && !modalidadeId;
        if (planoNaoMapeado || cobrancaNaoMapeada) {
          resumo.nao_mapeados.push({ codigo: linha.codigo, plano: linha.plano_pagamento, cobranca: linha.cobranca });
          if (!planoId && !modalidadeId) return; // nada aplicável
        }

        const encontrados = await base44.entities.Cliente.filter({ codigo_interno: linha.codigo });
        if (!encontrados || encontrados.length === 0) {
          resumo.sem_cliente_no_banco.push(linha.codigo);
          return;
        }
        const cliente = encontrados[0];

        const update = {};
        if (planoId && planoId !== cliente.plano_pagamento_id) {
          if (!somente_vazios || !cliente.plano_pagamento_id) update.plano_pagamento_id = planoId;
        }
        if (modalidadeId && modalidadeId !== cliente.modalidade_pagamento_id) {
          if (!somente_vazios || !cliente.modalidade_pagamento_id) update.modalidade_pagamento_id = modalidadeId;
        }

        if (Object.keys(update).length === 0) {
          resumo.ja_corretos++;
          return;
        }

        await base44.entities.Cliente.update(cliente.id, update);
        resumo.atualizados++;
        updatesFeitos++;
      }));

      // Throttle leve a cada ~50 updates
      if (updatesFeitos >= 50) {
        await sleep(800);
        updatesFeitos = 0;
      }
    }

    return Response.json(resumo);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});