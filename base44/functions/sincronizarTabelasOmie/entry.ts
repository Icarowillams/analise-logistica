import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL_TABELA = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";
const OMIE_URL_PRODUTO = "https://app.omie.com.br/api/v1/geral/produtos/";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function logOmie(base44, payload) {
  try { await base44.asServiceRole.entities.LogIntegracaoOmie.create(payload); } catch (_) {}
}

async function omieCall(url, call, param) {
  const startedAt = Date.now();
  console.log(`[OMIE] ${call}`, JSON.stringify(param).substring(0, 200));
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
  });
  const data = await response.json();
  if (data.faultstring) console.log(`[OMIE] ERRO ${call}: ${data.faultstring}`);
  return { data, duracao_ms: Date.now() - startedAt };
}

async function listarTabelasOmie() {
  const todasTabelas = [];
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const { data } = await omieCall(OMIE_URL_TABELA, "ListarTabelasPreco", {
      nPagina: pagina, nRegPorPagina: 50
    });
    await delay(1000);
    if (data.faultstring) throw new Error(`Erro ao listar tabelas Omie: ${data.faultstring}`);
    totalPaginas = data.nTotPaginas || 1;
    if (data.listaTabelasPreco) todasTabelas.push(...data.listaTabelasPreco);
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
    const { data } = await omieCall(OMIE_URL_TABELA, "ListarTabelaItens", param);
    await delay(1000);
    if (data.faultstring) {
      if (/nenhum/i.test(data.faultstring)) return [];
      throw new Error(`Erro ao listar itens: ${data.faultstring}`);
    }
    totalPaginas = data.nTotPaginas || 1;
    if (data.itensTabela) todosItens.push(...data.itensTabela);
    pagina++;
  }
  return todosItens;
}

async function consultarProdutoOmiePorId(nCodProd) {
  const { data } = await omieCall(OMIE_URL_PRODUTO, "ConsultarProduto", { codigo_produto: nCodProd });
  if (data.faultstring) return null;
  return data;
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

      await logOmie(base44, {
        endpoint: 'produtos/tabelaprecos', call: 'ListarTabelasPreco',
        operacao: 'importar_tabelas', status: 'sucesso',
        mensagem_erro: `${criadas} criadas, ${atualizadas} atualizadas, ${tabelasOmie.length} total`,
        usuario_email: user.email
      });

      return Response.json({
        sucesso: true, mensagem: `${criadas} tabelas criadas, ${atualizadas} atualizadas.`,
        total_omie: tabelasOmie.length, resultados
      });
    }

    // ==========================================
    // EXPORTAR TABELA DO BASE44 → OMIE (cabeçalho)
    // ==========================================
    if (acao === "exportar_tabela") {
      const { tabela_id } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      if (!tabela) return Response.json({ error: "Tabela não encontrada" }, { status: 404 });

      const codInt = (tabela.omie_cod_int || `TP${tabela.id}`).substring(0, 20);
      let nCodTabPreco = tabela.omie_id || null;

      // Verificar se já existe no Omie
      if (!nCodTabPreco) {
        const { data: consulta } = await omieCall(OMIE_URL_TABELA, "ConsultarTabelaPreco", { cCodIntTabPreco: codInt });
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

      const callUsada = nCodTabPreco ? "AlterarTabelaPreco" : "IncluirTabelaPreco";
      let { data: tabelaResult, duracao_ms } = await omieCall(OMIE_URL_TABELA, callUsada, payload);
      await delay(1500);

      // Tabela obsoleta no Omie — recriar
      if (tabelaResult.faultstring && nCodTabPreco &&
          /não cadastrada|nao cadastrada/i.test(tabelaResult.faultstring)) {
        delete payload.nCodTabPreco;
        const r = await omieCall(OMIE_URL_TABELA, "IncluirTabelaPreco", payload);
        tabelaResult = r.data;
        await delay(1500);
        nCodTabPreco = null;
      }

      // Já cadastrada — buscar ID
      if (tabelaResult.faultstring && /já cadastrad/i.test(tabelaResult.faultstring)) {
        const { data: c } = await omieCall(OMIE_URL_TABELA, "ConsultarTabelaPreco", { cCodIntTabPreco: codInt });
        await delay(1000);
        if (!c.faultstring) {
          nCodTabPreco = c.nCodTabPreco;
        } else {
          await logOmie(base44, {
            endpoint: 'produtos/tabelaprecos', call: callUsada, operacao: 'exportar_tabela',
            entidade_tipo: 'TabelaPreco', entidade_id: tabela.id, status: 'erro',
            codigo_erro: tabelaResult.faultcode, mensagem_erro: tabelaResult.faultstring,
            payload_enviado: JSON.stringify(payload).slice(0, 3000), duracao_ms,
            usuario_email: user.email
          });
          return Response.json({ sucesso: false, erro: tabelaResult.faultstring });
        }
      } else if (tabelaResult.faultstring) {
        await logOmie(base44, {
          endpoint: 'produtos/tabelaprecos', call: callUsada, operacao: 'exportar_tabela',
          entidade_tipo: 'TabelaPreco', entidade_id: tabela.id, status: 'erro',
          codigo_erro: tabelaResult.faultcode, mensagem_erro: tabelaResult.faultstring,
          payload_enviado: JSON.stringify(payload).slice(0, 3000), duracao_ms,
          usuario_email: user.email
        });
        return Response.json({ sucesso: false, erro: tabelaResult.faultstring });
      } else {
        nCodTabPreco = tabelaResult.nCodTabPreco || nCodTabPreco;
      }

      const omieIdFinal = nCodTabPreco;

      // Salvar vínculo
      await base44.asServiceRole.entities.TabelaPreco.update(tabela.id, {
        omie_id: omieIdFinal, omie_cod_int: codInt
      });

      // Popular produtos padrão e ativar
      await omieCall(OMIE_URL_TABELA, "AtualizarProdutos", { nCodTabPreco: omieIdFinal, cCodIntTabPreco: codInt });
      await delay(3000);
      await omieCall(OMIE_URL_TABELA, "AtivarTabelaPreco", { nCodTabPreco: omieIdFinal, cCodIntTabPreco: codInt });
      await delay(2000);

      await logOmie(base44, {
        endpoint: 'produtos/tabelaprecos', call: callUsada, operacao: 'exportar_tabela',
        entidade_tipo: 'TabelaPreco', entidade_id: tabela.id, status: 'sucesso',
        payload_enviado: JSON.stringify(payload).slice(0, 3000), duracao_ms,
        usuario_email: user.email
      });

      return Response.json({
        sucesso: true, omie_id: omieIdFinal, omie_cod_int: codInt,
        mensagem: "Tabela exportada/atualizada no Omie"
      });
    }

    // ==========================================
    // EXPORTAR PREÇOS DE UMA TABELA → OMIE (em lotes)
    // ==========================================
    if (acao === "exportar_precos") {
      const { tabela_id, lote_inicio = 0, lote_tamanho = 5, omie_id_override } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
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
      const isAuxiliar = tabela?.nome?.toUpperCase().includes('TABELA AUXILIAR');

      for (const preco of lote) {
        const produto = produtos.find(p => p.id === preco.produto_id);
        if (!produto) {
          itensResultados.push({ produto_id: preco.produto_id, sucesso: false, mensagem: "Produto não encontrado no sistema" });
          continue;
        }

        // Usar codigo_omie já gravado (muito mais rápido que ConsultarProduto)
        const nCodProd = produto.codigo_omie ? Number(produto.codigo_omie) : null;
        if (!nCodProd) {
          itensResultados.push({
            produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
            sucesso: false, mensagem: "Produto sem codigo_omie. Sincronize os produtos primeiro."
          });
          continue;
        }

        let valorAtual = (preco.ativacao_acao && preco.valor_acao > 0) ? preco.valor_acao : (preco.valor_unitario || 0);

        // Preço zero ignorado (exceto TABELA AUXILIAR — usa R$0,01 para cadastrar)
        if (valorAtual <= 0 && !isAuxiliar) {
          itensResultados.push({
            produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
            sucesso: false, mensagem: "Preço zero, ignorado."
          });
          continue;
        }
        if (valorAtual <= 0 && isAuxiliar) valorAtual = 0.01;

        // Tentar AlterarPrecoItem
        let { data: itemResult } = await omieCall(OMIE_URL_TABELA, "AlterarPrecoItem", {
          nCodTabPreco: omieIdTabela, nCodProd, nValorTabela: Number(valorAtual.toFixed(2))
        });
        await delay(1200);

        // Se produto não está na tabela, incluir e tentar novamente
        if (itemResult.faultstring &&
            /não encontrado|não localizado|nao encontrado|não cadastrado na Tabela|nao cadastrado na Tabela/i.test(itemResult.faultstring)) {

          const { data: inclResult } = await omieCall(OMIE_URL_TABELA, "IncluirProdutoTabPreco", {
            nCodTabPreco: omieIdTabela, nCodProd
          });
          await delay(1500);

          if (inclResult.faultstring && !/já cadastrad/i.test(inclResult.faultstring)) {
            // Fallback: AtualizarProdutos (re-sincroniza toda a tabela)
            const codIntTabela = (tabela.omie_cod_int || `TP${tabela.id}`).substring(0, 20);
            await omieCall(OMIE_URL_TABELA, "AtualizarProdutos", {
              nCodTabPreco: omieIdTabela, cCodIntTabPreco: codIntTabela
            });
            await delay(2500);
          }

          const retry = await omieCall(OMIE_URL_TABELA, "AlterarPrecoItem", {
            nCodTabPreco: omieIdTabela, nCodProd, nValorTabela: Number(valorAtual.toFixed(2))
          });
          itemResult = retry.data;
          await delay(1500);
        }

        const sucesso = !itemResult.faultstring;
        try {
          await base44.asServiceRole.entities.PrecoProduto.update(preco.id, {
            preco_omie_sincronizado: sucesso ? 'sim' : 'nao'
          });
        } catch (_) {}

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

      const { data: result, duracao_ms } = await omieCall(OMIE_URL_TABELA, "ExcluirTabelaPreco", param);
      await delay(1000);

      await logOmie(base44, {
        endpoint: 'produtos/tabelaprecos', call: 'ExcluirTabelaPreco',
        operacao: 'excluir_tabela', entidade_tipo: 'TabelaPreco', entidade_id: tabela.id,
        status: result.faultstring ? 'erro' : 'sucesso',
        codigo_erro: result.faultcode, mensagem_erro: result.faultstring,
        duracao_ms, usuario_email: user.email
      });

      if (result.faultstring) return Response.json({ sucesso: false, erro: result.faultstring });

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

        // Buscar produto local por codigo_omie gravado
        let produtoBase44 = produtos.find(p => p.codigo_omie && Number(p.codigo_omie) === Number(nCodProd));

        // Fallback: consultar Omie para pegar codigo_produto_integracao
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
            valor_unitario: valorTabela, preco_omie_sincronizado: 'sim'
          });
          atualizados++;
        } else {
          await base44.asServiceRole.entities.PrecoProduto.create({
            produto_id: produtoBase44.id, tabela_id: tabela.id,
            valor_unitario: valorTabela, valor_acao: 0, ativacao_acao: false,
            preco_omie_sincronizado: 'sim'
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