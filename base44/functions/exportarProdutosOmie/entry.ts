import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/produtos/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { produto_ids, modo = "upsert", lote_inicio = 0 } = body;

        if (!produto_ids || !Array.isArray(produto_ids) || produto_ids.length === 0) {
            return Response.json({ error: 'Informe os IDs dos produtos para exportar' }, { status: 400 });
        }

        // Processar no máximo 10 produtos por chamada (Omie tem limite rigoroso de ~50 req/min)
        const LOTE_MAX = 10;
        const produtosDoLote = produto_ids.slice(lote_inicio, lote_inicio + LOTE_MAX);
        
        if (produtosDoLote.length === 0) {
            return Response.json({ 
                concluido: true,
                resumo: { total: 0, sucessos: 0, erros: 0 },
                resultados: []
            });
        }

        // Buscar produtos, unidades de medida e categorias
        const [produtos, unidadesMedida, categorias] = await Promise.all([
            base44.entities.Produto.list(),
            base44.entities.UnidadeMedida.list(),
            base44.entities.Categoria.list()
        ]);

        const produtosParaExportar = produtos.filter(p => produtosDoLote.includes(p.id));

        const resultados = [];
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (const produto of produtosParaExportar) {
            // Buscar unidade de medida - usar o nome como sigla (UN, KG, FD, PCT, GR)
            const unidade = unidadesMedida.find(u => u.id === produto.unidade_medida_id);
            const unidadeSigla = unidade?.nome?.substring(0, 6)?.toUpperCase() || "UN";

            // Buscar categoria
            const categoria = categorias.find(c => c.id === produto.categoria_id);

            // Campos obrigatórios conforme documentação Omie API:
            // - codigo_produto_integracao: código único de integração (nosso ID interno)
            // - codigo: código do produto (até 60 caracteres)
            // - descricao: nome/descrição do produto (até 120 caracteres)
            // - unidade: unidade de medida (UN, KG, CX, FD, PCT, GR, etc)
            // - ncm: NCM obrigatório (8 dígitos) - usar 1905.90.90 como padrão para pães
            // - cest: CEST opcional (7 dígitos)
            const ncmProduto = produto.ncm?.replace(/[^\d]/g, "") || "19059090"; // NCM padrão: Outros produtos de padaria
            const cestProduto = produto.cest?.replace(/[^\d]/g, "") || "";
            
            const produtoOmie = {
                codigo_produto_integracao: produto.id,
                codigo: (produto.codigo || produto.id).substring(0, 60),
                descricao: (produto.nome || "Produto sem nome").substring(0, 120),
                unidade: unidadeSigla,
                ncm: ncmProduto.substring(0, 8),
                peso_bruto: produto.peso || 0,
                peso_liq: produto.peso || 0,
                bloqueado: produto.status === 'inativo' ? "S" : "N",
                bloquear_exclusao: "N",
                inativo: produto.status === 'inativo' ? "S" : "N"
            };

            // CEST - campo na raiz (string9, deprecated mas ainda funcional)
            if (cestProduto) {
                produtoOmie.cest = cestProduto.substring(0, 9);
            }

            // Adicionar código de barras se existir (EAN/GTIN - até 14 dígitos)
            if (produto.cod_barras && produto.cod_barras.trim()) {
                produtoOmie.ean = produto.cod_barras.replace(/[^\d]/g, "").substring(0, 14);
            }

            // Adicionar descrição detalhada com categoria se existir
            if (categoria) {
                produtoOmie.descr_detalhada = `Categoria: ${categoria.nome}`.substring(0, 5000);
            }

            const metodo = modo === "incluir" ? "IncluirProduto" : "UpsertProduto";

            try {
                const response = await fetch(OMIE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: metodo,
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [produtoOmie]
                    })
                });

                const resultado = await response.json();

                resultados.push({
                    produto_id: produto.id,
                    nome: produto.nome,
                    codigo: produto.codigo,
                    sucesso: !resultado.faultstring,
                    codigo_omie: resultado.codigo_produto || null,
                    mensagem: resultado.faultstring || resultado.descricao_status || "Exportado com sucesso"
                });
            } catch (err) {
                resultados.push({
                    produto_id: produto.id,
                    nome: produto.nome,
                    codigo: produto.codigo,
                    sucesso: false,
                    codigo_omie: null,
                    mensagem: err.message
                });
            }

            // Aguardar 3000ms entre requisições para evitar rate limit da Omie
            // A API Omie tem limite rigoroso e bloqueia por 30 minutos se exceder
            await delay(3000);
        }

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.filter(r => !r.sucesso).length;
        const proximoLote = lote_inicio + LOTE_MAX;
        const concluido = proximoLote >= produto_ids.length;

        return Response.json({
            concluido,
            proximo_lote: concluido ? null : proximoLote,
            total_geral: produto_ids.length,
            resumo: {
                total: resultados.length,
                sucessos,
                erros
            },
            resultados
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});