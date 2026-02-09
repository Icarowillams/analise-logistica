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
    return await response.json();
}

// Consultar produto no Omie pelo codigo_produto_integracao para obter nCodProd
async function buscarProdutoOmie(codigoIntegracao) {
    const result = await omieCall(OMIE_URL_PRODUTO, "ConsultarProduto", {
        codigo_produto_integracao: codigoIntegracao
    });
    if (result.faultstring) {
        // Tentar pelo codigo do produto
        return null;
    }
    return result.codigo_produto || null;
}

// Consultar tabela no Omie pelo cCodIntTabPreco para obter nCodTabPreco
async function buscarTabelaOmie(codIntTabPreco) {
    const result = await omieCall(OMIE_URL_TABELA, "ConsultarTabelaPreco", {
        cCodIntTabPreco: codIntTabPreco
    });
    if (result.faultstring) {
        return null;
    }
    return result.nCodTabPreco || null;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
        }

        const body = await req.json();
        const { tabela_ids, lote_inicio = 0 } = body;

        if (!tabela_ids || !Array.isArray(tabela_ids) || tabela_ids.length === 0) {
            return Response.json({ error: 'Informe os IDs das tabelas para exportar' }, { status: 400 });
        }

        // Buscar dados do sistema
        const [tabelas, precos, produtos] = await Promise.all([
            base44.entities.TabelaPreco.list(),
            base44.entities.PrecoProduto.list(),
            base44.entities.Produto.list()
        ]);

        const tabelasParaExportar = tabelas.filter(t => tabela_ids.includes(t.id));
        const resultados = [];

        // Processar 1 tabela por vez para evitar rate limit
        const LOTE_MAX = 1;
        const tabelaDoLote = tabelasParaExportar.slice(lote_inicio, lote_inicio + LOTE_MAX);

        if (tabelaDoLote.length === 0) {
            return Response.json({
                concluido: true,
                resumo: { total: 0, sucessos: 0, erros: 0 },
                resultados: []
            });
        }

        for (const tabela of tabelaDoLote) {
            const codInt = `TP_${tabela.id}`;
            const precosTabela = precos.filter(p => p.tabela_id === tabela.id);

            // 1. Tentar incluir ou alterar a tabela no Omie
            let nCodTabPreco = null;
            
            // Primeiro tenta consultar se já existe
            try {
                nCodTabPreco = await buscarTabelaOmie(codInt);
                await delay(1500);
            } catch (e) {
                // ignora
            }

            if (nCodTabPreco) {
                // Alterar tabela existente
                const alterResult = await omieCall(OMIE_URL_TABELA, "AlterarTabelaPreco", {
                    nCodTabPreco: nCodTabPreco,
                    cCodIntTabPreco: codInt,
                    cNome: tabela.nome,
                    cCodigo: tabela.nome.substring(0, 20).toUpperCase().replace(/\s+/g, '_'),
                    cOrigem: "PRD",
                    produtos: { cTodosProdutos: "S" },
                    clientes: { cTodosClientes: "S" },
                    outrasInfo: { nPercAcrescimo: 0, nPercDesconto: 0 },
                    caracteristicas: { cTemValidade: "N", cTemDesconto: "N", cArredPreco: "N" }
                });
                await delay(1500);

                if (alterResult.faultstring) {
                    resultados.push({
                        tabela_id: tabela.id,
                        tabela_nome: tabela.nome,
                        etapa: "alterar_tabela",
                        sucesso: false,
                        mensagem: alterResult.faultstring,
                        itens_resultados: []
                    });
                    continue;
                }
            } else {
                // Incluir nova tabela
                const inclResult = await omieCall(OMIE_URL_TABELA, "IncluirTabelaPreco", {
                    cCodIntTabPreco: codInt,
                    cNome: tabela.nome,
                    cCodigo: tabela.nome.substring(0, 20).toUpperCase().replace(/\s+/g, '_'),
                    cOrigem: "PRD",
                    produtos: { cTodosProdutos: "S" },
                    clientes: { cTodosClientes: "S" },
                    outrasInfo: { nPercAcrescimo: 0, nPercDesconto: 0 },
                    caracteristicas: { cTemValidade: "N", cTemDesconto: "N", cArredPreco: "N" }
                });
                await delay(1500);

                if (inclResult.faultstring) {
                    resultados.push({
                        tabela_id: tabela.id,
                        tabela_nome: tabela.nome,
                        etapa: "incluir_tabela",
                        sucesso: false,
                        mensagem: inclResult.faultstring,
                        itens_resultados: []
                    });
                    continue;
                }
                nCodTabPreco = inclResult.nCodTabPreco;
            }

            // 2. Atualizar produtos na tabela
            const atualizarResult = await omieCall(OMIE_URL_TABELA, "AtualizarProdutos", {
                nCodTabPreco: nCodTabPreco,
                cCodIntTabPreco: codInt
            });
            await delay(1500);

            // 3. Para cada preço, alterar o preço do item na tabela
            const itensResultados = [];
            
            for (const preco of precosTabela) {
                const produto = produtos.find(p => p.id === preco.produto_id);
                if (!produto) continue;

                // Buscar codigo_produto no Omie usando o ID como codigo_produto_integracao
                let nCodProd = null;
                try {
                    nCodProd = await buscarProdutoOmie(produto.id);
                    await delay(1500);
                } catch (e) {
                    // ignora
                }

                if (!nCodProd) {
                    itensResultados.push({
                        produto_id: produto.id,
                        produto_nome: produto.nome,
                        produto_codigo: produto.codigo,
                        sucesso: false,
                        mensagem: "Produto não encontrado no Omie. Exporte os produtos primeiro."
                    });
                    continue;
                }

                // Determinar o valor atual (se ação ativa, usar valor_acao, senão valor_unitario)
                const valorAtual = (preco.ativacao_acao && preco.valor_acao > 0) 
                    ? preco.valor_acao 
                    : (preco.valor_unitario || 0);

                if (valorAtual <= 0) {
                    itensResultados.push({
                        produto_id: produto.id,
                        produto_nome: produto.nome,
                        produto_codigo: produto.codigo,
                        sucesso: false,
                        mensagem: "Preço zero ou negativo, ignorado."
                    });
                    continue;
                }

                const itemResult = await omieCall(OMIE_URL_TABELA, "AlterarPrecoItem", {
                    nCodTabPreco: nCodTabPreco,
                    nCodProd: nCodProd,
                    nValorTabela: valorAtual
                });
                await delay(1500);

                itensResultados.push({
                    produto_id: produto.id,
                    produto_nome: produto.nome,
                    produto_codigo: produto.codigo,
                    valor: valorAtual,
                    sucesso: !itemResult.faultstring,
                    mensagem: itemResult.faultstring || "Preço atualizado com sucesso"
                });
            }

            const itensOk = itensResultados.filter(i => i.sucesso).length;
            const itensErro = itensResultados.filter(i => !i.sucesso).length;

            resultados.push({
                tabela_id: tabela.id,
                tabela_nome: tabela.nome,
                nCodTabPreco: nCodTabPreco,
                etapa: "concluido",
                sucesso: true,
                mensagem: `Tabela exportada. ${itensOk} preços atualizados, ${itensErro} erros.`,
                itens_resultados: itensResultados
            });
        }

        const proximoLote = lote_inicio + LOTE_MAX;
        const concluido = proximoLote >= tabelasParaExportar.length;

        return Response.json({
            concluido,
            proximo_lote: concluido ? null : proximoLote,
            total_tabelas: tabelasParaExportar.length,
            resumo: {
                total: resultados.length,
                sucessos: resultados.filter(r => r.sucesso).length,
                erros: resultados.filter(r => !r.sucesso).length
            },
            resultados
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});