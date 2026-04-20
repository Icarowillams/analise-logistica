import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const onlyDigits = (s) => (s || '').toString().replace(/\D/g, '');

async function omieCall(call, param) {
  const res = await fetch(OMIE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
  });
  return res.json();
}

async function listarClientesOmie() {
  const todos = [];
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const data = await omieCall("ListarClientesResumido", {
      pagina, registros_por_pagina: 500, apenas_importado_api: "N"
    });
    await delay(800);
    if (data.faultstring) throw new Error(`Omie ListarClientesResumido: ${data.faultstring}`);
    totalPaginas = data.total_de_paginas || 1;
    if (data.clientes_cadastro_resumido) todos.push(...data.clientes_cadastro_resumido);
    pagina++;
  }
  return todos;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { apenas_simular = false } = body;

    console.log('[IMPORTAR] Buscando clientes do Omie...');
    const clientesOmie = await listarClientesOmie();
    console.log(`[IMPORTAR] ${clientesOmie.length} clientes no Omie`);

    const clientesBase44 = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
    console.log(`[IMPORTAR] ${clientesBase44.length} clientes no Base44`);

    // Index Base44 por CNPJ/CPF normalizado
    const porDoc = new Map();
    for (const c of clientesBase44) {
      const d = onlyDigits(c.cnpj_cpf);
      if (d) porDoc.set(d, c);
    }

    let vinculados = 0;
    let jaVinculados = 0;
    let naoEncontrados = 0;
    const naoEncontradosAmostra = [];
    const atualizacoes = [];

    for (const cOmie of clientesOmie) {
      const docOmie = onlyDigits(cOmie.cnpj_cpf);
      const codigoOmie = String(cOmie.codigo_cliente_omie || '');
      if (!docOmie || !codigoOmie) continue;

      const match = porDoc.get(docOmie);
      if (!match) {
        naoEncontrados++;
        if (naoEncontradosAmostra.length < 20) {
          naoEncontradosAmostra.push({
            codigo_omie: codigoOmie,
            nome: cOmie.razao_social || cOmie.nome_fantasia,
            cnpj_cpf: cOmie.cnpj_cpf
          });
        }
        continue;
      }

      if (String(match.codigo_omie || '') === codigoOmie) {
        jaVinculados++;
        continue;
      }

      atualizacoes.push({ id: match.id, codigo_omie: codigoOmie, nome: match.razao_social });
    }

    if (!apenas_simular) {
      for (const up of atualizacoes) {
        await base44.asServiceRole.entities.Cliente.update(up.id, { codigo_omie: up.codigo_omie });
        vinculados++;
        if (vinculados % 100 === 0) console.log(`[IMPORTAR] ${vinculados}/${atualizacoes.length} vinculados`);
      }
    }

    return Response.json({
      sucesso: true,
      simulacao: apenas_simular,
      total_omie: clientesOmie.length,
      total_base44: clientesBase44.length,
      ja_vinculados: jaVinculados,
      novos_vinculos: apenas_simular ? atualizacoes.length : vinculados,
      nao_encontrados_no_base44: naoEncontrados,
      amostra_nao_encontrados: naoEncontradosAmostra
    });
  } catch (error) {
    console.error('[IMPORTAR] ERRO:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});