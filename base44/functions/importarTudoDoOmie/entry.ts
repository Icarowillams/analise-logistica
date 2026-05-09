import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL_TABELA = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";
const OMIE_URL_PRODUTO = "https://app.omie.com.br/api/v1/geral/produtos/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function omieCall(url, call, param) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
  });
  return await res.json();
}

// Lista produtos do Omie com paginação
async function listarProdutosOmie() {
  const todos = [];
  let pagina = 1, total = 1;
  while (pagina <= total) {
    const data = await omieCall(OMIE_URL_PRODUTO, "ListarProdutos", {
      pagina, registros_por_pagina: 50, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N"
    });
    await delay(1100);
    if (data.faultstring) throw new Error(`ListarProdutos: ${data.faultstring}`);
    total = data.total_de_paginas || 1;
    if (data.produto_servico_cadastro) todos.push(...data.produto_servico_cadastro);
    pagina++;
  }
  return todos;
}

async function listarTabelasOmie() {
  const todas = [];
  let pagina = 1, total = 1;
  while (pagina <= total) {
    const data = await omieCall(OMIE_URL_TABELA, "ListarTabelasPreco", { nPagina: pagina, nRegPorPagina: 50 });
    await delay(1100);
    if (data.faultstring) throw new Error(`ListarTabelasPreco: ${data.faultstring}`);
    total = data.nTotPaginas || 1;
    if (data.listaTabelasPreco) todas.push(...data.listaTabelasPreco);
    pagina++;
  }
  return todas;
}

async function listarItensTabela(nCodTabPreco) {
  const todos = [];
  let pagina = 1, total = 1;
  while (pagina <= total) {
    const data = await omieCall(OMIE_URL_TABELA, "ListarTabelaItens", {
      nPagina: pagina, nRegPorPagina: 50, nCodTabPreco
    });
    await delay(1100);
    if (data.faultstring) {
      if (/nenhum/i.test(data.faultstring)) return [];
      throw new Error(`ListarTabelaItens: ${data.faultstring}`);
    }
    total = data.nTotPaginas || 1;
    // Resposta real: listaTabelaPreco.itensTabela (não itensTabela direto)
    const itens = data.listaTabelaPreco?.itensTabela || data.itensTabela || [];
    if (itens.length) todos.push(...itens);
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
    const { etapa } = body; // "produtos" | "tabelas" | "precos"

    // ============================================================
    // ETAPA 1: Vincular produtos (grava codigo_omie nos Produtos)
    // ============================================================
    if (etapa === "produtos") {
      const produtosOmie = await listarProdutosOmie();
      const produtosBase44 = await base44.asServiceRole.entities.Produto.list('', 10000);

      let vinculados = 0, naoEncontrados = 0;
      const naoEncontradosList = [];

      for (const pOmie of produtosOmie) {
        const codigo = String(pOmie.codigo || '').trim();
        if (!codigo) continue;
        const local = produtosBase44.find(p => String(p.codigo).trim() === codigo);
        if (!local) {
          naoEncontrados++;
          naoEncontradosList.push({ codigo, descricao: pOmie.descricao });
          continue;
        }
        await base44.asServiceRole.entities.Produto.update(local.id, {
          codigo_omie: String(pOmie.codigo_produto)
        });
        vinculados++;
      }

      return Response.json({
        sucesso: true,
        total_omie: produtosOmie.length,
        vinculados,
        nao_encontrados: naoEncontrados,
        nao_encontrados_amostra: naoEncontradosList.slice(0, 10)
      });
    }

    // ============================================================
    // ETAPA 2: Vincular tabelas (grava omie_id nas TabelaPreco)
    // ============================================================
    if (etapa === "tabelas") {
      const tabelasOmie = await listarTabelasOmie();
      const tabelasBase44 = await base44.asServiceRole.entities.TabelaPreco.list('', 1000);

      let vinculadas = 0, criadas = 0;
      for (const tOmie of tabelasOmie) {
        const nome = (tOmie.cNome || '').trim();
        const omieId = tOmie.nCodTabPreco;
        const codInt = tOmie.cCodIntTabPreco || '';
        const ativo = tOmie.cAtiva === 'S';

        let existente = tabelasBase44.find(t => t.omie_id === omieId);
        if (!existente) {
          existente = tabelasBase44.find(t => (t.nome || '').trim().toUpperCase() === nome.toUpperCase());
        }

        if (existente) {
          await base44.asServiceRole.entities.TabelaPreco.update(existente.id, {
            nome, status: ativo ? 'ativo' : 'inativo', omie_id: omieId, omie_cod_int: codInt
          });
          vinculadas++;
        } else {
          const nova = await base44.asServiceRole.entities.TabelaPreco.create({
            nome, status: ativo ? 'ativo' : 'inativo', omie_id: omieId, omie_cod_int: codInt
          });
          tabelasBase44.push({ ...nova, omie_id: omieId });
          criadas++;
        }
      }

      return Response.json({
        sucesso: true,
        total_omie: tabelasOmie.length,
        vinculadas,
        criadas
      });
    }

    // ============================================================
    // ETAPA 3: Importar preços de TODAS as tabelas vinculadas
    // ============================================================
    if (etapa === "precos") {
      // Processa APENAS as tabelas passadas em tabela_ids (ou lote a partir do índice)
      const { tabela_ids, inicio = 0, quantidade = 5, limpar_antes = false } = body;

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list('', 1000);
      let tabelasVinculadas = tabelas.filter(t => t.omie_id);

      if (tabela_ids && tabela_ids.length > 0) {
        tabelasVinculadas = tabelasVinculadas.filter(t => tabela_ids.includes(t.id));
      } else {
        tabelasVinculadas = tabelasVinculadas.slice(inicio, inicio + quantidade);
      }

      const produtos = await base44.asServiceRole.entities.Produto.list('', 10000);
      const mapaProdutoPorCodigo = new Map();
      for (const p of produtos) {
        if (p.codigo) mapaProdutoPorCodigo.set(String(p.codigo).trim(), p.id);
      }

      const resumo = [];
      let totalCriados = 0, totalAtualizados = 0, totalIgnorados = 0;

      for (const tabela of tabelasVinculadas) {
        const itens = await listarItensTabela(tabela.omie_id);

        // Opcional: limpar preços antigos desta tabela (para espelhar 100% o Omie)
        if (limpar_antes) {
          const antigos = await base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id: tabela.id });
          for (const a of antigos) await base44.asServiceRole.entities.PrecoProduto.delete(a.id);
        }

        const precosExistentes = limpar_antes ? [] : await base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id: tabela.id });
        const mapaPrecoPorProduto = new Map();
        for (const pe of precosExistentes) mapaPrecoPorProduto.set(pe.produto_id, pe);

        let criados = 0, atualizados = 0, ignorados = 0;
        const novos = [];

        for (const item of itens) {
          const codigoInterno = String(item.cCodigoProduto || '').trim();
          const valor = Number(item.nValorTabela || 0);
          const produtoId = mapaProdutoPorCodigo.get(codigoInterno);
          if (!produtoId) { ignorados++; continue; }

          const existente = mapaPrecoPorProduto.get(produtoId);
          if (existente) {
            await base44.asServiceRole.entities.PrecoProduto.update(existente.id, {
              valor_unitario: valor, omie_sincronizado: true
            });
            atualizados++;
          } else {
            novos.push({
              produto_id: produtoId,
              tabela_id: tabela.id,
              valor_unitario: valor,
              valor_acao: 0,
              ativacao_acao: false,
              omie_sincronizado: true
            });
            criados++;
          }
        }

        if (novos.length > 0) {
          const chunkSize = 50;
          for (let i = 0; i < novos.length; i += chunkSize) {
            await base44.asServiceRole.entities.PrecoProduto.bulkCreate(novos.slice(i, i + chunkSize));
          }
        }

        totalCriados += criados;
        totalAtualizados += atualizados;
        totalIgnorados += ignorados;
        resumo.push({ tabela: tabela.nome, itens_omie: itens.length, criados, atualizados, ignorados });
      }

      const totalTabelasVinculadas = tabelas.filter(t => t.omie_id).length;
      const proximoInicio = inicio + quantidade;
      const concluido = tabela_ids ? true : proximoInicio >= totalTabelasVinculadas;

      return Response.json({
        sucesso: true,
        tabelas_processadas: tabelasVinculadas.length,
        total_criados: totalCriados,
        total_atualizados: totalAtualizados,
        total_ignorados: totalIgnorados,
        concluido,
        proximo_inicio: concluido ? null : proximoInicio,
        total_tabelas: totalTabelasVinculadas,
        resumo
      });
    }

    return Response.json({ error: 'etapa inválida. Use: produtos | tabelas | precos' }, { status: 400 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});