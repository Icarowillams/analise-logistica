import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL_TABELA = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";
const OMIE_URL_PRODUTO = "https://app.omie.com.br/api/v1/geral/produtos/";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function omieCall(url, call, param) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [param]
    })
  });
  const data = await response.json();
  return data;
}

// ==========================================
// LISTAR TABELAS DO OMIE (paginado)
// ==========================================
async function listarTabelasOmie() {
  const todasTabelas = [];
  let pagina = 1;
  let totalPaginas = 1;

  while (pagina <= totalPaginas) {
    const result = await omieCall(OMIE_URL_TABELA, "ListarTabelasPreco", {
      nPagina: pagina,
      nRegPorPagina: 50
    });
    await delay(1000);

    if (result.faultstring) {
      throw new Error(`Erro ao listar tabelas Omie: ${result.faultstring}`);
    }

    totalPaginas = result.nTotPaginas || 1;
    if (result.listaTabelasPreco) {
      todasTabelas.push(...result.listaTabelasPreco);
    }
    pagina++;
  }

  return todasTabelas;
}

// ==========================================
// LISTAR ITENS DE UMA TABELA DO OMIE (paginado)
// ==========================================
async function listarItensTabela(nCodTabPreco, cCodIntTabPreco) {
  const todosItens = [];
  let pagina = 1;
  let totalPaginas = 1;

  while (pagina <= totalPaginas) {
    const param = { nPagina: pagina, nRegPorPagina: 50 };
    if (nCodTabPreco) param.nCodTabPreco = nCodTabPreco;
    if (cCodIntTabPreco) param.cCodIntTabPreco = cCodIntTabPreco;

    const result = await omieCall(OMIE_URL_TABELA, "ListarTabelaItens", param);
    await delay(1000);

    if (result.faultstring) {
      // Se não tem itens, retorna vazio
      if (result.faultstring.includes("Nenhum") || result.faultstring.includes("nenhum")) {
        return [];
      }
      throw new Error(`Erro ao listar itens: ${result.faultstring}`);
    }

    totalPaginas = result.nTotPaginas || 1;
    if (result.itensTabela) {
      todosItens.push(...result.itensTabela);
    }
    pagina++;
  }

  return todosItens;
}

// ==========================================
// BUSCAR PRODUTO NO OMIE PELO CÓDIGO INTEGRAÇÃO
// ==========================================
async function buscarProdutoOmie(codigoIntegracao) {
  const result = await omieCall(OMIE_URL_PRODUTO, "ConsultarProduto", {
    codigo_produto_integracao: codigoIntegracao
  });
  if (result.faultstring) return null;
  return result.codigo_produto || null;
}

// ==========================================
// BUSCAR PRODUTO NO OMIE PELO nCodProd
// ==========================================
async function consultarProdutoOmiePorId(nCodProd) {
  const result = await omieCall(OMIE_URL_PRODUTO, "ConsultarProduto", {
    codigo_produto: nCodProd
  });
  if (result.faultstring) return null;
  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const body = await req.json();
    const { acao } = body;
    // acao: "importar_tabelas" | "exportar_tabela" | "exportar_precos" | "excluir_tabela" | "importar_precos"

    // ==========================================
    // IMPORTAR TABELAS DO OMIE → BASE44
    // ==========================================
    if (acao === "importar_tabelas") {
      const tabelasOmie = await listarTabelasOmie();
      const tabelasBase44 = await base44.asServiceRole.entities.TabelaPreco.list();

      const resultados = [];
      let criadas = 0;
      let atualizadas = 0;

      for (const tOmie of tabelasOmie) {
        const omieId = tOmie.nCodTabPreco;
        const codInt = tOmie.cCodIntTabPreco || "";
        const nome = tOmie.cNome || "";
        const ativo = tOmie.cAtiva === "S";

        // Buscar por omie_id ou omie_cod_int
        let existente = tabelasBase44.find(t => 
          t.omie_id === omieId || 
          (t.omie_cod_int && t.omie_cod_int === codInt)
        );

        // Também buscar por nome caso não tenha vínculo
        if (!existente) {
          existente = tabelasBase44.find(t => 
            t.nome?.trim().toUpperCase() === nome.trim().toUpperCase() && !t.omie_id
          );
        }

        if (existente) {
          await base44.asServiceRole.entities.TabelaPreco.update(existente.id, {
            nome: nome,
            status: ativo ? "ativo" : "inativo",
            omie_id: omieId,
            omie_cod_int: codInt
          });
          atualizadas++;
          resultados.push({ nome, omie_id: omieId, status: "atualizada" });
        } else {
          await base44.asServiceRole.entities.TabelaPreco.create({
            nome: nome,
            status: ativo ? "ativo" : "inativo",
            omie_id: omieId,
            omie_cod_int: codInt
          });
          criadas++;
          resultados.push({ nome, omie_id: omieId, status: "criada" });
        }
        await delay(200);
      }

      return Response.json({
        sucesso: true,
        mensagem: `${criadas} tabelas criadas, ${atualizadas} atualizadas.`,
        total_omie: tabelasOmie.length,
        resultados
      });
    }

    // ==========================================
    // EXPORTAR TABELA DO BASE44 → OMIE
    // ==========================================
    if (acao === "exportar_tabela") {
      const { tabela_id } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      if (!tabela) return Response.json({ error: "Tabela não encontrada" }, { status: 404 });

      // Omie limita cCodIntTabPreco a 20 caracteres
      const codInt = tabela.omie_cod_int || `TP${tabela.id}`.substring(0, 20);
      let nCodTabPreco = tabela.omie_id || null;

      // Verificar se já existe no Omie
      if (!nCodTabPreco) {
        const consulta = await omieCall(OMIE_URL_TABELA, "ConsultarTabelaPreco", {
          cCodIntTabPreco: codInt
        });
        await delay(1000);
        if (!consulta.faultstring) {
          nCodTabPreco = consulta.nCodTabPreco;
        }
      }

      const payload = {
        cCodIntTabPreco: codInt,
        cNome: tabela.nome,
        cCodigo: tabela.nome.substring(0, 20).toUpperCase().replace(/\s+/g, '_'),
        cOrigem: "CMC",
        produtos: { cTodosProdutos: "S" },
        clientes: { cTodosClientes: "S" },
        outrasInfo: {},
        caracteristicas: { cTemValidade: "N", cTemDesconto: "N", cArredPreco: "N" }
      };

      // Se é alteração, adicionar nCodTabPreco
      if (nCodTabPreco) {
        payload.nCodTabPreco = nCodTabPreco;
      }

      const tabelaResult = nCodTabPreco
        ? await omieCall(OMIE_URL_TABELA, "AlterarTabelaPreco", payload)
        : await omieCall(OMIE_URL_TABELA, "IncluirTabelaPreco", payload);
      await delay(1000);

      if (tabelaResult.faultstring) {
        return Response.json({ sucesso: false, erro: tabelaResult.faultstring });
      }

      const omieIdFinal = tabelaResult.nCodTabPreco || nCodTabPreco;

      // Atualizar vínculo no Base44
      await base44.asServiceRole.entities.TabelaPreco.update(tabela.id, {
        omie_id: omieIdFinal,
        omie_cod_int: codInt
      });

      // Atualizar produtos da tabela no Omie
      await omieCall(OMIE_URL_TABELA, "AtualizarProdutos", {
        nCodTabPreco: omieIdFinal,
        cCodIntTabPreco: codInt
      });
      await delay(1000);

      // ATIVAR a tabela para que ela funcione
      await omieCall(OMIE_URL_TABELA, "AtivarTabelaPreco", {
        nCodTabPreco: omieIdFinal,
        cCodIntTabPreco: codInt
      });
      await delay(1000);

      return Response.json({
        sucesso: true,
        mensagem: nCodTabPreco ? "Tabela atualizada no Omie" : "Tabela criada no Omie",
        omie_id: omieIdFinal,
        omie_cod_int: codInt
      });
    }

    // ==========================================
    // EXPORTAR PREÇOS DE UMA TABELA → OMIE
    // ==========================================
    if (acao === "exportar_precos") {
      const { tabela_id, lote_inicio = 0, lote_tamanho = 10 } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      if (!tabela || !tabela.omie_id) {
        return Response.json({ error: "Tabela não vinculada ao Omie. Exporte a tabela primeiro." }, { status: 400 });
      }

      const [precos, produtos] = await Promise.all([
        base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id: tabela.id }),
        base44.asServiceRole.entities.Produto.list()
      ]);

      const lote = precos.slice(lote_inicio, lote_inicio + lote_tamanho);
      const itensResultados = [];

      for (const preco of lote) {
        const produto = produtos.find(p => p.id === preco.produto_id);
        if (!produto) {
          itensResultados.push({ produto_id: preco.produto_id, sucesso: false, mensagem: "Produto não encontrado no sistema" });
          continue;
        }

        // Buscar nCodProd no Omie
        let nCodProd = null;
        try {
          nCodProd = await buscarProdutoOmie(produto.id);
          await delay(1000);
        } catch (e) { /* ignora */ }

        if (!nCodProd) {
          itensResultados.push({
            produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
            sucesso: false, mensagem: "Produto não encontrado no Omie. Exporte os produtos primeiro."
          });
          continue;
        }

        const valorAtual = (preco.ativacao_acao && preco.valor_acao > 0) ? preco.valor_acao : (preco.valor_unitario || 0);
        if (valorAtual <= 0) {
          itensResultados.push({
            produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
            sucesso: false, mensagem: "Preço zero ou negativo, ignorado."
          });
          continue;
        }

        const itemResult = await omieCall(OMIE_URL_TABELA, "AlterarPrecoItem", {
          nCodTabPreco: tabela.omie_id,
          nCodProd: nCodProd,
          nValorTabela: valorAtual
        });
        await delay(1000);

        const sucesso = !itemResult.faultstring;
        
        // Marcar como sincronizado no Base44
        if (sucesso) {
          await base44.asServiceRole.entities.PrecoProduto.update(preco.id, { omie_sincronizado: true });
        }

        itensResultados.push({
          produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
          valor: valorAtual, sucesso, mensagem: itemResult.faultstring || "Preço atualizado no Omie"
        });
      }

      const proximoLote = lote_inicio + lote_tamanho;
      const concluido = proximoLote >= precos.length;

      return Response.json({
        sucesso: true,
        concluido,
        proximo_lote: concluido ? null : proximoLote,
        total_precos: precos.length,
        processados: Math.min(proximoLote, precos.length),
        itens: itensResultados
      });
    }

    // ==========================================
    // EXCLUIR TABELA DO OMIE
    // ==========================================
    if (acao === "excluir_tabela") {
      const { tabela_id } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      if (!tabela) return Response.json({ error: "Tabela não encontrada" }, { status: 404 });

      if (!tabela.omie_id && !tabela.omie_cod_int) {
        return Response.json({ error: "Tabela não está vinculada ao Omie" }, { status: 400 });
      }

      const param = {};
      if (tabela.omie_id) param.nCodTabPreco = tabela.omie_id;
      if (tabela.omie_cod_int) param.cCodIntTabPreco = tabela.omie_cod_int;

      const result = await omieCall(OMIE_URL_TABELA, "ExcluirTabelaPreco", param);
      await delay(1000);

      if (result.faultstring) {
        return Response.json({ sucesso: false, erro: result.faultstring });
      }

      // Limpar vínculo no Base44
      await base44.asServiceRole.entities.TabelaPreco.update(tabela.id, {
        omie_id: null,
        omie_cod_int: null
      });

      return Response.json({
        sucesso: true,
        mensagem: `Tabela "${tabela.nome}" excluída do Omie`
      });
    }

    // ==========================================
    // IMPORTAR PREÇOS DO OMIE → BASE44
    // ==========================================
    if (acao === "importar_precos") {
      const { tabela_id } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      if (!tabela || !tabela.omie_id) {
        return Response.json({ error: "Tabela não vinculada ao Omie" }, { status: 400 });
      }

      // Listar itens da tabela no Omie
      const itensOmie = await listarItensTabela(tabela.omie_id, tabela.omie_cod_int);

      // Buscar preços e produtos existentes no Base44
      const [precosBase44, produtos] = await Promise.all([
        base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id: tabela.id }),
        base44.asServiceRole.entities.Produto.list()
      ]);

      let criados = 0;
      let atualizados = 0;
      let naoEncontrados = 0;
      const erros = [];

      for (const item of itensOmie) {
        const nCodProd = item.nCodProd;
        const valorTabela = item.nValorTabela || 0;

        if (valorTabela <= 0) continue;

        // Buscar produto no Base44 que tenha sido exportado ao Omie
        // Tentar por código de integração (que é o ID do Base44)
        let produtoBase44 = produtos.find(p => p.id === String(nCodProd));
        
        if (!produtoBase44) {
          // Consultar produto no Omie para pegar o codigo_produto_integracao
          const prodOmie = await consultarProdutoOmiePorId(nCodProd);
          await delay(800);
          
          if (prodOmie && prodOmie.codigo_produto_integracao) {
            produtoBase44 = produtos.find(p => p.id === prodOmie.codigo_produto_integracao);
          }
          if (!produtoBase44 && prodOmie && prodOmie.codigo) {
            produtoBase44 = produtos.find(p => p.codigo === prodOmie.codigo);
          }
        }

        if (!produtoBase44) {
          naoEncontrados++;
          erros.push({ nCodProd, valor: valorTabela, erro: "Produto não encontrado no Base44" });
          continue;
        }

        // Verificar se já existe preço para esta combinação
        const precoExistente = precosBase44.find(p => p.produto_id === produtoBase44.id);

        if (precoExistente) {
          await base44.asServiceRole.entities.PrecoProduto.update(precoExistente.id, {
            valor_unitario: valorTabela,
            omie_sincronizado: true
          });
          atualizados++;
        } else {
          await base44.asServiceRole.entities.PrecoProduto.create({
            produto_id: produtoBase44.id,
            tabela_id: tabela.id,
            valor_unitario: valorTabela,
            valor_acao: 0,
            ativacao_acao: false,
            omie_sincronizado: true
          });
          criados++;
        }
        await delay(200);
      }

      return Response.json({
        sucesso: true,
        mensagem: `${criados} preços criados, ${atualizados} atualizados, ${naoEncontrados} produtos não encontrados.`,
        total_itens_omie: itensOmie.length,
        criados,
        atualizados,
        nao_encontrados: naoEncontrados,
        erros
      });
    }

    return Response.json({ error: `Ação "${acao}" não reconhecida. Use: importar_tabelas, exportar_tabela, exportar_precos, excluir_tabela, importar_precos` }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});