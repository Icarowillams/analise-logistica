import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/produtos/";

function mapearProdutoParaOmie(produto, unidadeSigla) {
    const ncmProduto = produto.ncm?.replace(/[^\d]/g, "") || "19059090";
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

    if (cestProduto) {
        produtoOmie.cest = cestProduto.substring(0, 9);
    }

    if (produto.cod_barras && produto.cod_barras.trim()) {
        produtoOmie.ean = produto.cod_barras.replace(/[^\d]/g, "").substring(0, 14);
    }

    return produtoOmie;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();

        const { event, data: produto } = body;

        console.log('[enviarProdutoOmie] Event:', JSON.stringify(event));

        let produtoData = produto;
        if ((body.payload_too_large || !produtoData || !produtoData.nome) && event?.entity_id) {
            console.log('[enviarProdutoOmie] Buscando produto via SDK, entity_id:', event.entity_id);
            produtoData = await base44.asServiceRole.entities.Produto.get(event.entity_id);
        }

        if (!produtoData || (!produtoData.id && !event?.entity_id)) {
            console.log('[enviarProdutoOmie] Produto não informado no payload');
            return Response.json({ error: 'Produto não informado' }, { status: 400 });
        }

        if (!produtoData.id && event?.entity_id) {
            produtoData.id = event.entity_id;
        }

        console.log('[enviarProdutoOmie] Produto:', produtoData.nome, '- Código:', produtoData.codigo, '- ID:', produtoData.id);

        // Buscar unidade de medida
        let unidadeSigla = "UN";
        if (produtoData.unidade_medida_id) {
            try {
                const unidades = await base44.asServiceRole.entities.UnidadeMedida.list();
                const unidade = unidades.find(u => u.id === produtoData.unidade_medida_id);
                if (unidade?.nome) {
                    unidadeSigla = unidade.nome.substring(0, 6).toUpperCase();
                }
            } catch (e) {
                console.log('[enviarProdutoOmie] Erro ao buscar unidade:', e.message);
            }
        }

        const produtoOmie = mapearProdutoParaOmie(produtoData, unidadeSigla);

        console.log('[enviarProdutoOmie] Payload Omie:', JSON.stringify(produtoOmie).substring(0, 800));

        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "UpsertProduto",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [produtoOmie]
            })
        });

        const resultado = await response.json();

        console.log('[enviarProdutoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            console.error('[enviarProdutoOmie] Erro Omie:', resultado.faultstring);
            return Response.json({
                sucesso: false,
                erro: resultado.faultstring,
                produto_id: produtoData.id
            });
        }

        console.log('[enviarProdutoOmie] Produto enviado:', produtoData.nome, '- Código Omie:', resultado.codigo_produto);

        return Response.json({
            sucesso: true,
            produto_id: produtoData.id,
            codigo_omie: resultado.codigo_produto,
            mensagem: resultado.descricao_status || "Produto enviado com sucesso"
        });

    } catch (error) {
        console.error('[enviarProdutoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});