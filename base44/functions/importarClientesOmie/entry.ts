import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7: _shared/omieClient
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const onlyDigits = (s) => (s || '').toString().replace(/\D/g, '');

// ✅ omieCall local → wrapper _shared/omieClient
async function omieCall(base44, callOrEndpoint, param, optsOrUndef) {
  if (typeof optsOrUndef === 'object' && optsOrUndef !== null) return omieCallShared(base44, callOrEndpoint, param, optsOrUndef);
  if (callOrEndpoint && callOrEndpoint.includes('/')) return omieCallShared(base44, callOrEndpoint, param, {});
  return omieCallShared(base44, 'geral/clientes/', param, { call: callOrEndpoint });
}

/**
 * Importa clientes do Omie para o Base44 vinculando codigo_omie por CNPJ/CPF.
 *
 * Processa UMA PÁGINA do Omie por chamada (500 clientes/página).
 * O frontend deve chamar em loop passando `pagina` até `concluido=true`.
 *
 * Payload:
 *   - pagina: número da página do Omie a processar (default 1)
 *   - apenas_simular: true não grava, só retorna contagens
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { pagina = 1, apenas_simular = false } = body;

    // 1. Buscar UMA página do Omie (Doc Omie: máx 100 reg/página)
    const data = await omieCall("ListarClientes", {
      pagina, registros_por_pagina: 100, apenas_importado_api: "N"
    });
    if (data.faultstring) throw new Error(`Omie ListarClientes: ${data.faultstring}`);

    const clientesOmie = data.clientes_cadastro || [];
    const totalPaginas = data.total_de_paginas || 1;
    const totalRegistros = data.total_de_registros || clientesOmie.length;

    // 2. Buscar TODOS clientes Base44 (só na primeira página — depois poderíamos cachear, mas é rápido)
    const clientesBase44 = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);

    // Index Base44 por CNPJ/CPF normalizado
    const porDoc = new Map();
    for (const c of clientesBase44) {
      const d = onlyDigits(c.cnpj_cpf);
      if (d) porDoc.set(d, c);
    }

    // 3. Processar apenas os clientes desta página
    let vinculados = 0;
    let jaVinculados = 0;
    let naoEncontrados = 0;
    const atualizacoes = [];
    const naoEncontradosAmostra = [];

    for (const cOmie of clientesOmie) {
      const docOmie = onlyDigits(cOmie.cnpj_cpf);
      const codigoOmie = String(cOmie.codigo_cliente_omie || '');
      if (!docOmie || !codigoOmie) continue;

      const match = porDoc.get(docOmie);
      if (!match) {
        naoEncontrados++;
        if (naoEncontradosAmostra.length < 10) {
          naoEncontradosAmostra.push({
            codigo_omie: codigoOmie,
            nome: cOmie.razao_social,
            cnpj_cpf: cOmie.cnpj_cpf
          });
        }
        continue;
      }
      if (String(match.codigo_omie || '') === codigoOmie) {
        // Mesmo já vinculado, atualizar nome_fantasia se estiver vazio no Base44 mas preenchido no Omie
        const nfOmie = (cOmie.nome_fantasia || '').trim();
        if (nfOmie && !match.nome_fantasia) {
          atualizacoes.push({ id: match.id, codigo_omie: codigoOmie, nome_fantasia: nfOmie });
        }
        jaVinculados++;
        continue;
      }
      const nfOmie2 = (cOmie.nome_fantasia || '').trim();
      const upd = { id: match.id, codigo_omie: codigoOmie };
      if (nfOmie2 && !match.nome_fantasia) upd.nome_fantasia = nfOmie2;
      atualizacoes.push(upd);
    }

    // 4. Gravar — sequencial com retry em 429 (rate limit Base44)
    const erros = [];
    async function updateComRetry(id, data, maxTentativas = 5) {
      for (let t = 1; t <= maxTentativas; t++) {
        try {
          await base44.asServiceRole.entities.Cliente.update(id, data);
          return true;
        } catch (err) {
          const is429 = /429|Rate limit/i.test(err.message || '');
          if (is429 && t < maxTentativas) {
            await delay(1500 * t); // backoff: 1.5s, 3s, 4.5s, 6s
            continue;
          }
          erros.push({ id, erro: err.message });
          return false;
        }
      }
      return false;
    }

    if (!apenas_simular && atualizacoes.length > 0) {
      for (const up of atualizacoes) {
        const payload = { codigo_omie: up.codigo_omie };
        if (up.nome_fantasia) payload.nome_fantasia = up.nome_fantasia;
        const ok = await updateComRetry(up.id, payload);
        if (ok) vinculados++;
        await delay(120); // throttle: ~8 req/s, bem abaixo do limite
      }
    }

    return Response.json({
      sucesso: true,
      simulacao: apenas_simular,
      pagina,
      total_paginas: totalPaginas,
      total_registros_omie: totalRegistros,
      concluido: pagina >= totalPaginas,
      proxima_pagina: pagina < totalPaginas ? pagina + 1 : null,
      nesta_pagina: {
        clientes_omie: clientesOmie.length,
        novos_vinculos: apenas_simular ? atualizacoes.length : vinculados,
        ja_vinculados: jaVinculados,
        nao_encontrados: naoEncontrados,
        erros: erros.length,
        amostra_nao_encontrados: naoEncontradosAmostra
      }
    });
  } catch (error) {
    console.error('[IMPORTAR] ERRO:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});