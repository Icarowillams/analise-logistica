import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL_TABELA = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";
const OMIE_URL_PRODUTO = "https://app.omie.com.br/api/v1/geral/produtos/";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function omieCall(url, call, param) {
    console.log(`[OMIE] Chamando ${call}`, JSON.stringify(param).substring(0, 200));
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
    if (data.faultstring) {
        console.log(`[OMIE] ERRO ${call}: ${data.faultstring}`);
    } else {
        console.log(`[OMIE] OK ${call}`);
    }
    return data;
}

// Buscar nCodProd pelo codigo_produto_integracao
async function buscarProdutoOmie(codigoIntegracao) {
    const result = await omieCall(OMIE_URL_PRODUTO, "ConsultarProduto", {
        codigo_produto_integracao: codigoIntegracao
    });
    if (result.faultstring) return null;
    return result.codigo_produto || null;
}

// Consultar tabela pelo cCodIntTabPreco
async function buscarTabelaOmie(codIntTabPreco) {
    const result = await omieCall(OMIE_URL_TABELA, "ConsultarTabelaPreco", {
        cCodIntTabPreco: codIntTabPreco
    });
    if (result.faultstring) return null;
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

        const [tabelas, precos, produtos] = await Promise.all([
            base44.entities.TabelaPreco.list(),
            base44.entities.PrecoProduto.list(),
            base44.entities.Produto.list()
        ]);

        const tabelasParaExportar = tabelas.filter(t => tabela_ids.includes(t.id));

        // Processar 1 tabela por chamada
        const tabela = tabelasParaExportar[lote_inicio];
        if (!tabela) {
            return Response.json({
                concluido: true,
                resumo: { total: 0, sucessos: 0, erros: 0 },
                resultados: []
            });
        }

        const codInt = tabela.omie_cod_int || `TP_${tabela.id}`;
        const precosTabela = precos.filter(p => p.tabela_id === tabela.id);

        console.log(`\n========== EXPORTANDO TABELA: ${tabela.nome} (${precosTabela.length} preços) ==========`);

        // =============================================
        // ETAPA 1: Criar ou Alterar a tabela no Omie
        // =============================================
        let nCodTabPreco = null;

        // Verificar se já existe
        nCodTabPreco = await buscarTabelaOmie(codInt);
        await delay(1500);

        const tabelaPayload = {
            cCodIntTabPreco: codInt,
            cNome: tabela.nome,
            cCodigo: tabela.nome.substring(0, 20).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
            cOrigem: "CMC",
            produtos: { cTodosProdutos: "S" },
            clientes: { cTodosClientes: "S" },
            outrasInfo: { nCodOrigTab: 0, nPercAcrescimo: 0, nPercDesconto: 0 },
            caracteristicas: { cTemValidade: "N", cTemDesconto: "N", cArredPreco: "N" }
        };

        if (nCodTabPreco) {
            console.log(`[INFO] Tabela já existe no Omie: nCodTabPreco=${nCodTabPreco}. Alterando...`);
            tabelaPayload.nCodTabPreco = nCodTabPreco;
            const alterResult = await omieCall(OMIE_URL_TABELA, "AlterarTabelaPreco", tabelaPayload);
            await delay(1500);

            if (alterResult.faultstring) {
                if (alterResult.faultstring.includes("não cadastrada") || alterResult.faultstring.includes("nao cadastrada")) {
                    console.log(`[INFO] Tabela obsoleta no Omie, criando nova...`);
                    nCodTabPreco = null;
                } else {
                    return Response.json({
                        concluido: false,
                        proximo_lote: lote_inicio + 1,
                        total_tabelas: tabelasParaExportar.length,
                        resultados: [{
                            tabela_id: tabela.id, tabela_nome: tabela.nome,
                            etapa: "alterar_tabela", sucesso: false,
                            mensagem: alterResult.faultstring, itens_resultados: []
                        }]
                    });
                }
            }
        }

        if (!nCodTabPreco) {
            console.log(`[INFO] Criando nova tabela no Omie...`);
            delete tabelaPayload.nCodTabPreco;
            const inclResult = await omieCall(OMIE_URL_TABELA, "IncluirTabelaPreco", tabelaPayload);
            await delay(1500);

            if (inclResult.faultstring) {
                // Se já existe com mesmo código, tentar pegar o ID
                if (inclResult.faultstring.includes("já cadastrad")) {
                    console.log(`[INFO] Tabela já cadastrada, buscando ID...`);
                    nCodTabPreco = await buscarTabelaOmie(codInt);
                    await delay(1000);
                }
                
                if (!nCodTabPreco) {
                    return Response.json({
                        concluido: false,
                        proximo_lote: lote_inicio + 1,
                        total_tabelas: tabelasParaExportar.length,
                        resultados: [{
                            tabela_id: tabela.id, tabela_nome: tabela.nome,
                            etapa: "incluir_tabela", sucesso: false,
                            mensagem: inclResult.faultstring, itens_resultados: []
                        }]
                    });
                }
            } else {
                nCodTabPreco = inclResult.nCodTabPreco;
            }
        }

        console.log(`[INFO] Tabela Omie ID: ${nCodTabPreco}`);

        // Salvar vínculo no Base44
        await base44.asServiceRole.entities.TabelaPreco.update(tabela.id, {
            omie_id: nCodTabPreco,
            omie_cod_int: codInt
        });

        // =============================================
        // ETAPA 2: Atualizar produtos na tabela
        // =============================================
        console.log(`[INFO] Atualizando produtos na tabela...`);
        const atualizarResult = await omieCall(OMIE_URL_TABELA, "AtualizarProdutos", {
            nCodTabPreco: nCodTabPreco,
            cCodIntTabPreco: codInt
        });
        // Aguardar bastante para o Omie processar a inclusão dos produtos
        await delay(3000);

        // =============================================
        // ETAPA 3: Ativar a tabela
        // =============================================
        console.log(`[INFO] Ativando tabela...`);
        await omieCall(OMIE_URL_TABELA, "AtivarTabelaPreco", {
            nCodTabPreco: nCodTabPreco,
            cCodIntTabPreco: codInt
        });
        await delay(2000);

        // =============================================
        // ETAPA 4: Definir preço de cada item
        // =============================================
        const itensResultados = [];

        for (let i = 0; i < precosTabela.length; i++) {
            const preco = precosTabela[i];
            const produto = produtos.find(p => p.id === preco.produto_id);
            if (!produto) {
                itensResultados.push({
                    produto_id: preco.produto_id, sucesso: false,
                    mensagem: "Produto não encontrado no sistema"
                });
                continue;
            }

            console.log(`[ITEM ${i+1}/${precosTabela.length}] ${produto.nome} (${produto.codigo})`);

            // Buscar nCodProd no Omie
            const nCodProd = await buscarProdutoOmie(produto.id);
            await delay(1500);

            if (!nCodProd) {
                console.log(`[ITEM] SKIP - produto não existe no Omie`);
                itensResultados.push({
                    produto_id: produto.id, produto_nome: produto.nome,
                    produto_codigo: produto.codigo, sucesso: false,
                    mensagem: "Produto não encontrado no Omie. Exporte os produtos primeiro."
                });
                continue;
            }

            // Determinar valor
            const valorAtual = (preco.ativacao_acao && preco.valor_acao > 0)
                ? preco.valor_acao
                : (preco.valor_unitario || 0);

            if (valorAtual <= 0) {
                console.log(`[ITEM] SKIP - preço zero`);
                itensResultados.push({
                    produto_id: produto.id, produto_nome: produto.nome,
                    produto_codigo: produto.codigo, sucesso: false,
                    mensagem: "Preço zero ou negativo, ignorado."
                });
                continue;
            }

            // Tentar AlterarPrecoItem com nValorTabela (define preço customizado CMC)
            console.log(`[ITEM] Definindo preço R$ ${valorAtual.toFixed(2)} para nCodProd=${nCodProd}`);
            const itemResult = await omieCall(OMIE_URL_TABELA, "AlterarPrecoItem", {
                nCodTabPreco: nCodTabPreco,
                nCodProd: nCodProd,
                nValorTabela: Number(valorAtual.toFixed(2))
            });
            await delay(2000);

            if (itemResult.faultstring) {
                // Se produto não está na tabela, tentar IncluirProdutoTabPreco primeiro
                if (itemResult.faultstring.includes("não encontrado") || 
                    itemResult.faultstring.includes("não localizado") ||
                    itemResult.faultstring.includes("nao encontrado")) {
                    
                    console.log(`[ITEM] Produto não encontrado na tabela, tentando incluir...`);
                    
                    // Forçar inclusão do produto na tabela
                    const incluirProdResult = await omieCall(OMIE_URL_TABELA, "IncluirProdutoTabPreco", {
                        nCodTabPreco: nCodTabPreco,
                        nCodProd: nCodProd
                    });
                    await delay(2000);

                    if (!incluirProdResult.faultstring || incluirProdResult.faultstring.includes("já cadastrad")) {
                        console.log(`[ITEM] Produto incluído/já existia na tabela, tentando preço novamente...`);
                        
                        // Tentar novamente definir o preço
                        const retryResult = await omieCall(OMIE_URL_TABELA, "AlterarPrecoItem", {
                            nCodTabPreco: nCodTabPreco,
                            nCodProd: nCodProd,
                            nValorTabela: Number(valorAtual.toFixed(2))
                        });
                        await delay(2000);

                        itensResultados.push({
                            produto_id: produto.id, produto_nome: produto.nome,
                            produto_codigo: produto.codigo, valor: valorAtual,
                            sucesso: !retryResult.faultstring,
                            mensagem: retryResult.faultstring || "Preço atualizado (produto incluído na tabela)"
                        });
                        continue;
                    } else {
                        console.log(`[ITEM] Falha ao incluir produto na tabela: ${incluirProdResult.faultstring}`);
                    }
                }

                itensResultados.push({
                    produto_id: produto.id, produto_nome: produto.nome,
                    produto_codigo: produto.codigo, valor: valorAtual,
                    sucesso: false, mensagem: itemResult.faultstring
                });
            } else {
                itensResultados.push({
                    produto_id: produto.id, produto_nome: produto.nome,
                    produto_codigo: produto.codigo, valor: valorAtual,
                    sucesso: true, mensagem: "Preço atualizado com sucesso"
                });
            }
        }

        const itensOk = itensResultados.filter(i => i.sucesso).length;
        const itensErro = itensResultados.filter(i => !i.sucesso).length;

        console.log(`\n========== RESULTADO: ${itensOk} OK, ${itensErro} erros ==========\n`);

        const proximoLote = lote_inicio + 1;
        const concluido = proximoLote >= tabelasParaExportar.length;

        return Response.json({
            concluido,
            proximo_lote: concluido ? null : proximoLote,
            total_tabelas: tabelasParaExportar.length,
            resumo: {
                total: 1,
                sucessos: itensErro === itensResultados.length ? 0 : 1,
                erros: itensErro === itensResultados.length ? 1 : 0
            },
            resultados: [{
                tabela_id: tabela.id,
                tabela_nome: tabela.nome,
                nCodTabPreco: nCodTabPreco,
                etapa: "concluido",
                sucesso: true,
                mensagem: `Tabela exportada. ${itensOk} preços atualizados, ${itensErro} erros.`,
                itens_resultados: itensResultados
            }]
        });

    } catch (error) {
        console.error(`[FATAL] ${error.message}`);
        return Response.json({ error: error.message }, { status: 500 });
    }
});