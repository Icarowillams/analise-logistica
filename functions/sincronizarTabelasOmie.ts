import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL_TABELA = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";
const OMIE_URL_PRODUTO = "https://app.omie.com.br/api/v1/geral/produtos/";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function omieCall(url, call, param) {
  console.log(`[OMIE] ${call}`, JSON.stringify(param).substring(0, 200));
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
  if (data.faultstring) console.log(`[OMIE] ERRO ${call}: ${data.faultstring}`);
  return data;
}

async function listarTabelasOmie() {
  const todasTabelas = [];
  let pagina = 1;
  let totalPaginas = 1;

  while (pagina <= totalPaginas) {
    const result = await omieCall(OMIE_URL_TABELA, "ListarTabelasPreco", {
      nPagina: pagina, nRegPorPagina: 50
    });
    await delay(1000);
    if (result.faultstring) throw new Error(`Erro ao listar tabelas Omie: ${result.faultstring}`);
    totalPaginas = result.nTotPaginas || 1;
    if (result.listaTabelasPreco) todasTabelas.push(...result.listaTabelasPreco);
    pagina++;
  }
  return todasTabelas;
}

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
      if (result.faultstring.includes("Nenhum") || result.faultstring.includes("nenhum")) return [];
      throw new Error(`Erro ao listar itens: ${result.faultstring}`);
    }
    totalPaginas = result.nTotPaginas || 1;
    if (result.itensTabela) todosItens.push(...result.itensTabela);
    pagina++;
  }
  return todosItens;
}

async function buscarProdutoOmie(codigoIntegracao) {
  const result = await omieCall(OMIE_URL_PRODUTO, "ConsultarProduto", {
    codigo_produto_integracao: codigoIntegracao
  });
  if (result.faultstring) return null;
  return result.codigo_produto || null;
}

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

    // ==========================================
    // IMPORTAR TABELAS DO OMIE → BASE44
    // ==========================================
    if (acao === "importar_tabelas") {
      const tabelasOmie = await listarTabelasOmie();
      const tabelasBase44 = await base44.asServiceRole.entities.TabelaPreco.list();
      const resultados = [];
      let criadas = 0, atualizadas = 0;

      for (const tOmie of tabelasOmie) {
        const omieId = tOmie.nCodTabPreco;
        const codInt = tOmie.cCodIntTabPreco || "";
        const nome = tOmie.cNome || "";
        const ativo = tOmie.cAtiva === "S";

        let existente = tabelasBase44.find(t => t.omie_id === omieId || (t.omie_cod_int && t.omie_cod_int === codInt));
        if (!existente) {
          existente = tabelasBase44.find(t => t.nome?.trim().toUpperCase() === nome.trim().toUpperCase() && !t.omie_id);
        }

        if (existente) {
          await base44.asServiceRole.entities.TabelaPreco.update(existente.id, {
            nome, status: ativo ? "ativo" : "inativo", omie_id: omieId, omie_cod_int: codInt
          });
          atualizadas++;
          resultados.push({ nome, omie_id: omieId, status: "atualizada" });
        } else {
          await base44.asServiceRole.entities.TabelaPreco.create({
            nome, status: ativo ? "ativo" : "inativo", omie_id: omieId, omie_cod_int: codInt
          });
          criadas++;
          resultados.push({ nome, omie_id: omieId, status: "criada" });
        }
        await delay(200);
      }

      return Response.json({
        sucesso: true, mensagem: `${criadas} tabelas criadas, ${atualizadas} atualizadas.`,
        total_omie: tabelasOmie.length, resultados
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

      // Omie aceita no máximo 20 caracteres para cCodIntTabPreco
      const codIntRaw = tabela.omie_cod_int || `TP${tabela.id}`;
      const codInt = codIntRaw.substring(0, 20);
      let nCodTabPreco = tabela.omie_id || null;

      // Verificar se já existe no Omie
      if (!nCodTabPreco) {
        const consulta = await omieCall(OMIE_URL_TABELA, "ConsultarTabelaPreco", { cCodIntTabPreco: codInt });
        await delay(1000);
        if (!consulta.faultstring) nCodTabPreco = consulta.nCodTabPreco;
      }

      const payload = {
        cCodIntTabPreco: codInt,
        cNome: tabela.nome,
        cCodigo: tabela.nome.substring(0, 20).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
        cOrigem: "CMC",
        produtos: { cTodosProdutos: "S" },
        clientes: { cTodosClientes: "S" },
        outrasInfo: { nCodOrigTab: 0, nPercAcrescimo: 0, nPercDesconto: 0 },
        caracteristicas: { cTemValidade: "N", cTemDesconto: "N", cArredPreco: "N" }
      };

      if (nCodTabPreco) payload.nCodTabPreco = nCodTabPreco;

      let tabelaResult = nCodTabPreco
        ? await omieCall(OMIE_URL_TABELA, "AlterarTabelaPreco", payload)
        : await omieCall(OMIE_URL_TABELA, "IncluirTabelaPreco", payload);
      await delay(1500);

      // Tabela obsoleta
      if (tabelaResult.faultstring && nCodTabPreco &&
          (tabelaResult.faultstring.includes("não cadastrada") || tabelaResult.faultstring.includes("nao cadastrada"))) {
        delete payload.nCodTabPreco;
        tabelaResult = await omieCall(OMIE_URL_TABELA, "IncluirTabelaPreco", payload);
        await delay(1500);
        nCodTabPreco = null;
      }

      // Já cadastrada
      if (tabelaResult.faultstring && tabelaResult.faultstring.includes("já cadastrad")) {
        nCodTabPreco = await omieCall(OMIE_URL_TABELA, "ConsultarTabelaPreco", { cCodIntTabPreco: codInt });
        await delay(1000);
        if (nCodTabPreco && !nCodTabPreco.faultstring) {
          nCodTabPreco = nCodTabPreco.nCodTabPreco;
        } else {
          return Response.json({ sucesso: false, erro: tabelaResult.faultstring });
        }
      } else if (tabelaResult.faultstring) {
        return Response.json({ sucesso: false, erro: tabelaResult.faultstring });
      } else {
        nCodTabPreco = tabelaResult.nCodTabPreco || nCodTabPreco;
      }

      const omieIdFinal = nCodTabPreco;

      // Salvar vínculo
      await base44.asServiceRole.entities.TabelaPreco.update(tabela.id, {
        omie_id: omieIdFinal, omie_cod_int: codInt
      });

      // Atualizar produtos na tabela (API só aceita nCodTabPreco + cCodIntTabPreco)
      await omieCall(OMIE_URL_TABELA, "AtualizarProdutos", {
        nCodTabPreco: omieIdFinal, cCodIntTabPreco: codInt
      });
      await delay(3000);

      // Ativar tabela
      await omieCall(OMIE_URL_TABELA, "AtivarTabelaPreco", {
        nCodTabPreco: omieIdFinal, cCodIntTabPreco: codInt
      });
      await delay(2000);

      return Response.json({
        sucesso: true, omie_id: omieIdFinal, omie_cod_int: codInt,
        mensagem: "Tabela exportada/atualizada no Omie"
      });
    }

    // ==========================================
    // EXPORTAR PREÇOS DE UMA TABELA → OMIE
    // ==========================================
    if (acao === "exportar_precos") {
      const { tabela_id, lote_inicio = 0, lote_tamanho = 5, omie_id_override } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      
      // Usar omie_id_override se fornecido (caso a tabela acabou de ser exportada e o BD ainda não atualizou)
      const omieIdTabela = omie_id_override || tabela?.omie_id;
      
      if (!tabela || !omieIdTabela) {
        return Response.json({ error: "Tabela não vinculada ao Omie" }, { status: 400 });
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
        const nCodProd = await buscarProdutoOmie(produto.id);
        await delay(1500);

        if (!nCodProd) {
          itensResultados.push({
            produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
            sucesso: false, mensagem: "Produto não encontrado no Omie. Exporte os produtos primeiro."
          });
          continue;
        }

        let valorAtual = (preco.ativacao_acao && preco.valor_acao > 0) ? preco.valor_acao : (preco.valor_unitario || 0);
        
        // Para TABELA AUXILIAR, enviar todos os produtos mesmo com preço 0 (usar R$0.01 como mínimo)
        // Isso garante que todos os produtos sejam cadastrados na tabela do Omie
        const isAuxiliar = tabela?.nome?.toUpperCase().includes('TABELA AUXILIAR');
        
        if (valorAtual <= 0 && !isAuxiliar) {
          itensResultados.push({
            produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
            sucesso: false, mensagem: "Preço zero ou negativo, ignorado."
          });
          continue;
        }
        
        // Se auxiliar e preço 0, usar 0.01 para garantir cadastro
        if (valorAtual <= 0 && isAuxiliar) {
          valorAtual = 0.01;
          console.log(`[AUXILIAR] Produto ${produto.codigo} - ${produto.nome}: preço 0, usando R$0.01 para garantir cadastro no Omie`);
        }

        // Tentar AlterarPrecoItem (usar omieIdTabela em vez de tabela.omie_id)
        let itemResult = await omieCall(OMIE_URL_TABELA, "AlterarPrecoItem", {
          nCodTabPreco: omieIdTabela, nCodProd: nCodProd,
          nValorTabela: Number(valorAtual.toFixed(2))
        });
        await delay(2000);

        // Se produto não está na tabela, forçar AtualizarProdutos e tentar de novo
        if (itemResult.faultstring &&
            (itemResult.faultstring.includes("não encontrado") ||
             itemResult.faultstring.includes("não localizado") ||
             itemResult.faultstring.includes("nao encontrado") ||
             itemResult.faultstring.includes("não cadastrado na Tabela") ||
             itemResult.faultstring.includes("nao cadastrado na Tabela"))) {

          console.log(`[RETRY] Produto ${nCodProd} não está na tabela ${omieIdTabela}. Rodando AtualizarProdutos...`);
          
          // Usar codInt da tabela para AtualizarProdutos
          const codIntTabela = tabela.omie_cod_int || `TP${tabela.id}`.substring(0, 20);
          await omieCall(OMIE_URL_TABELA, "AtualizarProdutos", {
            nCodTabPreco: omieIdTabela, cCodIntTabPreco: codIntTabela,
            nPercAcrescimo: 0, nPercDesconto: 0
          });
          await delay(3000);

          // Tentar alterar o preço novamente
          itemResult = await omieCall(OMIE_URL_TABELA, "AlterarPrecoItem", {
            nCodTabPreco: omieIdTabela, nCodProd: nCodProd,
            nValorTabela: Number(valorAtual.toFixed(2))
          });
          await delay(2000);
        }

        const sucesso = !itemResult.faultstring;
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
        sucesso: true, concluido,
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

      await base44.asServiceRole.entities.TabelaPreco.update(tabela.id, {
        omie_id: null, omie_cod_int: null
      });

      return Response.json({ sucesso: true, mensagem: `Tabela "${tabela.nome}" excluída do Omie` });
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

      const itensOmie = await listarItensTabela(tabela.omie_id, tabela.omie_cod_int);
      const [precosBase44, produtos] = await Promise.all([
        base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id: tabela.id }),
        base44.asServiceRole.entities.Produto.list()
      ]);

      let criados = 0, atualizados = 0, naoEncontrados = 0;
      const erros = [];

      for (const item of itensOmie) {
        const nCodProd = item.nCodProd;
        const valorTabela = item.nValorTabela || 0;
        if (valorTabela <= 0) continue;

        let produtoBase44 = produtos.find(p => p.id === String(nCodProd));
        if (!produtoBase44) {
          const prodOmie = await consultarProdutoOmiePorId(nCodProd);
          await delay(800);
          if (prodOmie?.codigo_produto_integracao) {
            produtoBase44 = produtos.find(p => p.id === prodOmie.codigo_produto_integracao);
          }
          if (!produtoBase44 && prodOmie?.codigo) {
            produtoBase44 = produtos.find(p => p.codigo === prodOmie.codigo);
          }
        }

        if (!produtoBase44) {
          naoEncontrados++;
          erros.push({ nCodProd, valor: valorTabela, erro: "Produto não encontrado no Base44" });
          continue;
        }

        const precoExistente = precosBase44.find(p => p.produto_id === produtoBase44.id);
        if (precoExistente) {
          await base44.asServiceRole.entities.PrecoProduto.update(precoExistente.id, {
            valor_unitario: valorTabela, omie_sincronizado: true
          });
          atualizados++;
        } else {
          await base44.asServiceRole.entities.PrecoProduto.create({
            produto_id: produtoBase44.id, tabela_id: tabela.id,
            valor_unitario: valorTabela, valor_acao: 0, ativacao_acao: false, omie_sincronizado: true
          });
          criados++;
        }
        await delay(200);
      }

      return Response.json({
        sucesso: true,
        mensagem: `${criados} preços criados, ${atualizados} atualizados, ${naoEncontrados} produtos não encontrados.`,
        total_itens_omie: itensOmie.length, criados, atualizados, nao_encontrados: naoEncontrados, erros
      });
    }

    return Response.json({ error: `Ação "${acao}" não reconhecida.` }, { status: 400 });
  } catch (error) {
    console.error(`[FATAL] ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});