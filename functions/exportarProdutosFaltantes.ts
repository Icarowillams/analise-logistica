import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/produtos/";

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

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Acesso negado' }, { status: 403 });
        }

        const body = await req.json();
        const { acao = "verificar" } = body;
        // acao: "verificar" = só lista os faltantes, "exportar" = exporta os faltantes

        // Buscar todos os produtos ativos do Base44
        const [produtos, unidadesMedida, categorias] = await Promise.all([
            base44.entities.Produto.filter({ status: "ativo" }),
            base44.entities.UnidadeMedida.list(),
            base44.entities.Categoria.list()
        ]);

        console.log(`[INFO] Total de produtos ativos no Base44: ${produtos.length}`);

        // Verificar quais existem no Omie
        const faltantes = [];
        const existentes = [];

        for (const produto of produtos) {
            const resultado = await omieCall(OMIE_URL, "ConsultarProduto", {
                codigo_produto_integracao: produto.id
            });
            await delay(1500);

            if (resultado.faultstring) {
                // Não existe no Omie
                faltantes.push(produto);
                console.log(`[FALTANTE] Código ${produto.codigo} - ${produto.nome}`);
            } else {
                existentes.push({
                    codigo: produto.codigo,
                    nome: produto.nome,
                    omie_id: resultado.codigo_produto
                });
            }
        }

        console.log(`[INFO] Existentes no Omie: ${existentes.length}, Faltantes: ${faltantes.length}`);

        if (acao === "verificar") {
            return Response.json({
                sucesso: true,
                total_base44: produtos.length,
                total_omie: existentes.length,
                total_faltantes: faltantes.length,
                faltantes: faltantes.map(p => ({
                    id: p.id,
                    codigo: p.codigo,
                    nome: p.nome,
                    cod_barras: p.cod_barras || "",
                    ncm: p.ncm || ""
                })),
                existentes: existentes
            });
        }

        if (acao === "exportar") {
            // Exportar os faltantes para o Omie usando IncluirProduto
            const resultados = [];

            for (const produto of faltantes) {
                const unidade = unidadesMedida.find(u => u.id === produto.unidade_medida_id);
                const unidadeSigla = unidade?.nome?.substring(0, 6)?.toUpperCase() || "UN";
                const categoria = categorias.find(c => c.id === produto.categoria_id);
                const ncmProduto = (produto.ncm || "19059090").replace(/[^\d]/g, "").substring(0, 8);
                const cestProduto = (produto.cest || "").replace(/[^\d]/g, "");

                const produtoOmie = {
                    codigo_produto_integracao: produto.id,
                    codigo: (produto.codigo || produto.id).substring(0, 60),
                    descricao: (produto.nome || "Produto sem nome").substring(0, 120),
                    unidade: unidadeSigla,
                    ncm: ncmProduto || "19059090",
                    peso_bruto: produto.peso || 0,
                    peso_liq: produto.peso || 0,
                    bloqueado: "N",
                    bloquear_exclusao: "N",
                    inativo: "N"
                };

                if (cestProduto) {
                    produtoOmie.cest = cestProduto.substring(0, 9);
                }

                if (produto.cod_barras && produto.cod_barras.trim()) {
                    produtoOmie.ean = produto.cod_barras.replace(/[^\d]/g, "").substring(0, 14);
                }

                if (categoria) {
                    produtoOmie.descr_detalhada = `Categoria: ${categoria.nome}`.substring(0, 5000);
                }

                console.log(`[EXPORTANDO] Código ${produto.codigo} - ${produto.nome}`);

                let resultado = await omieCall(OMIE_URL, "IncluirProduto", produtoOmie);
                await delay(3000);

                // Se EAN duplicado, re-tentar sem o EAN
                if (resultado.faultstring && resultado.faultstring.includes("EAN")) {
                    console.log(`[RETRY] EAN duplicado para ${produto.codigo}. Re-enviando sem EAN...`);
                    delete produtoOmie.ean;
                    resultado = await omieCall(OMIE_URL, "IncluirProduto", produtoOmie);
                    await delay(3000);
                }

                const sucesso = !resultado.faultstring;
                resultados.push({
                    produto_id: produto.id,
                    codigo: produto.codigo,
                    nome: produto.nome,
                    sucesso,
                    codigo_omie: resultado.codigo_produto || null,
                    mensagem: resultado.faultstring || resultado.descricao_status || "Exportado com sucesso" + (produtoOmie.ean === undefined ? " (sem EAN - duplicado)" : "")
                });

                console.log(`[RESULTADO] ${produto.codigo}: ${sucesso ? 'OK' : resultado.faultstring}`);
            }

            const sucessos = resultados.filter(r => r.sucesso).length;
            const erros = resultados.filter(r => !r.sucesso).length;

            return Response.json({
                sucesso: true,
                total_faltantes: faltantes.length,
                exportados: sucessos,
                erros,
                resultados
            });
        }

        return Response.json({ error: "Ação inválida. Use 'verificar' ou 'exportar'." }, { status: 400 });

    } catch (error) {
        console.error(`[ERRO] ${error.message}`);
        return Response.json({ error: error.message }, { status: 500 });
    }
});