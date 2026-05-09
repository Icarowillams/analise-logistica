import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL_CENARIOS = "https://app.omie.com.br/api/v1/geral/cenarios/";
const OMIE_URL_ETAPAS = "https://app.omie.com.br/api/v1/produtos/etapafat/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function logOmie(base44, payload) {
  try { await base44.asServiceRole.entities.LogIntegracaoOmie.create(payload); } catch (_) {}
}

async function omieCall(url, call, param) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
  });
  const data = await response.json();
  return { data, duracao_ms: Date.now() - startedAt };
}

async function listarTodosCenarios() {
  const registros = [];
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const { data } = await omieCall(OMIE_URL_CENARIOS, "ListarCenarios", {
      nPagina: pagina, nRegPorPagina: 50
    });
    await delay(800);
    if (data.faultstring) throw new Error(`ListarCenarios: ${data.faultstring}`);
    totalPaginas = data.nTotPaginas || 1;
    if (data.cenariosEncontrados) registros.push(...data.cenariosEncontrados);
    pagina++;
  }
  return registros;
}

async function listarTodasEtapas() {
  const registros = [];
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const { data } = await omieCall(OMIE_URL_ETAPAS, "ListarEtapasFaturamento", {
      pagina, registros_por_pagina: 50
    });
    await delay(800);
    if (data.faultstring) {
      if (/nenhum/i.test(data.faultstring)) return registros;
      throw new Error(`ListarEtapasFaturamento: ${data.faultstring}`);
    }
    totalPaginas = data.total_de_paginas || 1;
    if (data.cadastros) registros.push(...data.cadastros);
    pagina++;
  }
  return registros;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const startedAt = Date.now();
    const existentes = await base44.asServiceRole.entities.CenarioFiscal.list();

    // ==========================================
    // IMPORTAR CENÁRIOS (Naturezas de Operação)
    // ==========================================
    let cenariosOmie = [];
    let cenariosErro = null;
    try {
      cenariosOmie = await listarTodosCenarios();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('chave de acesso') || msg.includes('não preenchida') || msg.includes('nao preenchida')) {
        cenariosErro = 'Módulo "Cenários de Impostos" não habilitado nesta conta Omie — apenas Etapas serão sincronizadas.';
      } else {
        throw err;
      }
    }
    let cenariosCriados = 0, cenariosAtualizados = 0;
    const resultadoCenarios = [];

    for (const c of cenariosOmie) {
      const omieId = String(c.nCodigo || '');
      const nome = c.cNome || 'Sem nome';
      const ativo = c.inativo !== 'S';

      const existente = existentes.find(
        e => e.tipo_registro === 'cenario' && e.omie_id === omieId
      );

      const dados = {
        tipo_registro: 'cenario',
        omie_id: omieId,
        codigo: omieId,
        nome,
        padrao: !!c.padrao,
        status: ativo ? 'ativo' : 'inativo'
      };

      if (existente) {
        await base44.asServiceRole.entities.CenarioFiscal.update(existente.id, dados);
        cenariosAtualizados++;
        resultadoCenarios.push({ nome, omie_id: omieId, status: 'atualizado' });
      } else {
        await base44.asServiceRole.entities.CenarioFiscal.create(dados);
        cenariosCriados++;
        resultadoCenarios.push({ nome, omie_id: omieId, status: 'criado' });
      }
      await delay(150);
    }

    // ==========================================
    // IMPORTAR ETAPAS DE FATURAMENTO (achatar estrutura aninhada)
    // Omie retorna: [{ cCodOperacao, cDescOperacao, etapas: [{cCodigo, cDescricao, cInativo}] }]
    // ==========================================
    const operacoesOmie = await listarTodasEtapas();
    const etapasFlat = [];
    for (const op of operacoesOmie) {
      if (!op?.cCodOperacao || !Array.isArray(op.etapas)) continue;
      for (const et of op.etapas) {
        etapasFlat.push({
          cCodOperacao: op.cCodOperacao,
          cDescOperacao: op.cDescOperacao || '',
          cCodigo: et.cCodigo,
          cDescricao: et.cDescricao || et.cDescrPadrao || '',
          cInativo: et.cInativo
        });
      }
    }

    let etapasCriadas = 0, etapasAtualizadas = 0;
    const resultadoEtapas = [];

    for (const e of etapasFlat) {
      // Código composto: operação + etapa (ex: "11-50" = Venda de Produto / Faturar)
      const codigo = `${e.cCodOperacao}-${e.cCodigo}`;
      const nome = `${e.cDescOperacao} / ${e.cDescricao || 'Sem descrição'}`;
      const ativo = e.cInativo !== 'S';

      const existente = existentes.find(
        ex => ex.tipo_registro === 'etapa' && ex.codigo === codigo
      );

      const dados = {
        tipo_registro: 'etapa',
        codigo,
        omie_id: codigo,
        nome,
        descricao: e.cDescOperacao,
        status: ativo ? 'ativo' : 'inativo'
      };

      if (existente) {
        await base44.asServiceRole.entities.CenarioFiscal.update(existente.id, dados);
        etapasAtualizadas++;
        resultadoEtapas.push({ codigo, nome, status: 'atualizada' });
      } else {
        await base44.asServiceRole.entities.CenarioFiscal.create(dados);
        etapasCriadas++;
        resultadoEtapas.push({ codigo, nome, status: 'criada' });
      }
      await delay(100);
    }

    const duracao_ms = Date.now() - startedAt;

    await logOmie(base44, {
      endpoint: 'geral/cenarios+produtos/etapafat',
      call: 'ListarCenarios+ListarEtapasFaturamento',
      operacao: 'importar_cenarios_fiscais',
      status: 'sucesso',
      mensagem_erro: `Cenários: ${cenariosCriados} criados, ${cenariosAtualizados} atualizados. Etapas: ${etapasCriadas} criadas, ${etapasAtualizadas} atualizadas.`,
      duracao_ms,
      usuario_email: user.email
    });

    return Response.json({
      sucesso: true,
      cenarios: {
        total_omie: cenariosOmie.length,
        criados: cenariosCriados,
        atualizados: cenariosAtualizados,
        detalhes: resultadoCenarios,
        aviso: cenariosErro
      },
      etapas: {
        total_omie: etapasFlat.length,
        total_operacoes: operacoesOmie.length,
        criadas: etapasCriadas,
        atualizadas: etapasAtualizadas,
        detalhes: resultadoEtapas
      },
      duracao_ms
    });
  } catch (error) {
    console.error('[importarCenariosFiscaisOmie] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});