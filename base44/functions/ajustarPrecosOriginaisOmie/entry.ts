import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL_PRODUTO = "https://app.omie.com.br/api/v1/geral/produtos/";
const OMIE_URL_TABELA = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";

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

async function buscarProdutoOmie(codigoIntegracao) {
    const result = await omieCall(OMIE_URL_PRODUTO, "ConsultarProduto", {
        codigo_produto_integracao: codigoIntegracao
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
        const { acao, tabela_ids, lote_inicio = 0, lote_tamanho = 5 } = body;

        // ======================================================
        // AÇÃO 1: Definir Preço Original = R$ 1,00 para todos
        // ======================================================
        if (acao === "definir_preco_original") {
            const { produto_ids } = body;

            if (!produto_ids || produto_ids.length === 0) {
                return Response.json({ error: 'Informe os IDs dos produtos' }, { status: 400 });
            }

            const produtos = await base44.asServiceRole.entities.Produto.list();
            const lote = produto_ids.slice(lote_inicio, lote_inicio + lote_tamanho);

            if (lote.length === 0) {
                return Response.json({ concluido: true, resultados: [] });
            }

            const resultados = [];

            for (const prodId of lote) {
                const produto = produtos.find(p => p.id === prodId);
                if (!produto) {
                    resultados.push({ produto_id: prodId, sucesso: false, mensagem: "Produto não encontrado no sistema" });
                    continue;
                }

                // Buscar produto no Omie
                const prodOmie = await buscarProdutoOmie(produto.id);
                await delay(1500);

                if (!prodOmie) {
                    resultados.push({ 
                        produto_id: produto.id, produto_nome: produto.nome,
                        sucesso: false, mensagem: "Produto não encontrado no Omie" 
                    });
                    continue;
                }

                // Alterar o valor_unitario (preço original) para 1.00
                const alterResult = await omieCall(OMIE_URL_PRODUTO, "AlterarProduto", {
                    codigo_produto: prodOmie.codigo_produto,
                    codigo_produto_integracao: produto.id,
                    codigo: prodOmie.codigo,
                    descricao: prodOmie.descricao,
                    unidade: prodOmie.unidade || "UN",
                    ncm: prodOmie.ncm || "19059090",
                    valor_unitario: 1.00
                });
                await delay(2000);

                if (alterResult.faultstring) {
                    resultados.push({
                        produto_id: produto.id, produto_nome: produto.nome,
                        sucesso: false, mensagem: alterResult.faultstring
                    });
                } else {
                    resultados.push({
                        produto_id: produto.id, produto_nome: produto.nome,
                        sucesso: true, mensagem: "Preço original definido como R$ 1,00"
                    });
                }
            }

            const proximoLote = lote_inicio + lote_tamanho;
            const concluido = proximoLote >= produto_ids.length;

            return Response.json({
                concluido,
                proximo_lote: concluido ? null : proximoLote,
                total: produto_ids.length,
                processados: Math.min(proximoLote, produto_ids.length),
                resultados
            });
        }

        // ======================================================
        // AÇÃO 2: Exportar preços das tabelas usando % acréscimo
        // Preço Original = R$ 1,00
        // Preço Tabela desejado = valor_unitario do Base44
        // % Acréscimo = (valor_desejado - 1) * 100
        // Ex: quero R$ 5,00 → acréscimo = 400%
        // ======================================================
        if (acao === "exportar_precos_percentual") {
            if (!tabela_ids || tabela_ids.length === 0) {
                return Response.json({ error: 'Informe os IDs das tabelas' }, { status: 400 });
            }

            const [tabelas, precos, produtos] = await Promise.all([
                base44.asServiceRole.entities.TabelaPreco.list(),
                base44.asServiceRole.entities.PrecoProduto.list(),
                base44.asServiceRole.entities.Produto.list()
            ]);

            const tabelasParaExportar = tabelas.filter(t => tabela_ids.includes(t.id));
            const resultados = [];

            // Processar 1 tabela por vez
            const tabela = tabelasParaExportar[lote_inicio];
            if (!tabela) {
                return Response.json({ concluido: true, resultados: [] });
            }

            if (!tabela.omie_id) {
                return Response.json({
                    concluido: false,
                    proximo_lote: lote_inicio + 1,
                    total_tabelas: tabelasParaExportar.length,
                    resultados: [{
                        tabela_id: tabela.id, tabela_nome: tabela.nome,
                        sucesso: false, mensagem: "Tabela não vinculada ao Omie. Exporte a tabela primeiro.",
                        itens: []
                    }]
                });
            }

            const precosTabela = precos.filter(p => p.tabela_id === tabela.id);
            const itensResultados = [];

            for (const preco of precosTabela) {
                const produto = produtos.find(p => p.id === preco.produto_id);
                if (!produto) continue;

                // Buscar nCodProd no Omie
                const prodOmie = await buscarProdutoOmie(produto.id);
                await delay(1500);

                if (!prodOmie) {
                    itensResultados.push({
                        produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
                        sucesso: false, mensagem: "Produto não encontrado no Omie"
                    });
                    continue;
                }

                const nCodProd = prodOmie.codigo_produto;

                // Determinar o valor desejado na tabela
                const valorDesejado = (preco.ativacao_acao && preco.valor_acao > 0) 
                    ? preco.valor_acao 
                    : (preco.valor_unitario || 0);

                if (valorDesejado <= 0) {
                    itensResultados.push({
                        produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
                        sucesso: false, mensagem: "Preço zero ou negativo, ignorado."
                    });
                    continue;
                }

                // Calcular % de acréscimo: preço original = R$ 1,00
                // valorDesejado = 1 * (1 + percAcrescimo/100)
                // percAcrescimo = (valorDesejado - 1) * 100
                const percAcrescimo = Number(((valorDesejado - 1) * 100).toFixed(4));

                // AlterarPrecoItem com nPercAcrescimo em vez de nValorTabela
                const itemResult = await omieCall(OMIE_URL_TABELA, "AlterarPrecoItem", {
                    nCodTabPreco: tabela.omie_id,
                    nCodProd: nCodProd,
                    nPercAcrescimo: percAcrescimo
                });
                await delay(2000);

                const sucesso = !itemResult.faultstring;

                if (sucesso) {
                    await base44.asServiceRole.entities.PrecoProduto.update(preco.id, { omie_sincronizado: true });
                }

                itensResultados.push({
                    produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
                    valor_desejado: valorDesejado, perc_acrescimo: percAcrescimo,
                    sucesso, mensagem: itemResult.faultstring || `Preço R$ ${valorDesejado.toFixed(2)} (acréscimo ${percAcrescimo.toFixed(2)}%)`
                });
            }

            const itensOk = itensResultados.filter(i => i.sucesso).length;
            const itensErro = itensResultados.filter(i => !i.sucesso).length;

            resultados.push({
                tabela_id: tabela.id, tabela_nome: tabela.nome,
                sucesso: true,
                mensagem: `${itensOk} preços atualizados, ${itensErro} erros.`,
                itens: itensResultados
            });

            const proximoLote = lote_inicio + 1;
            const concluido = proximoLote >= tabelasParaExportar.length;

            return Response.json({
                concluido,
                proximo_lote: concluido ? null : proximoLote,
                total_tabelas: tabelasParaExportar.length,
                resultados
            });
        }

        return Response.json({ error: `Ação "${acao}" não reconhecida` }, { status: 400 });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});