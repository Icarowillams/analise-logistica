import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/produtos/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();

        const { event, data: produto } = body;

        console.log('[excluirProdutoOmie] Event:', JSON.stringify(event));

        const produtoId = event?.entity_id || produto?.id;
        const produtoNome = produto?.nome || 'N/A';
        const produtoCodigo = produto?.codigo || 'N/A';

        if (!produtoId) {
            console.log('[excluirProdutoOmie] Nenhum ID de produto encontrado');
            return Response.json({ error: 'Produto não informado' }, { status: 400 });
        }

        console.log('[excluirProdutoOmie] Excluindo produto do Omie - ID:', produtoId, '- Nome:', produtoNome, '- Código:', produtoCodigo);

        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ExcluirProduto",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_produto_integracao: produtoId
                }]
            })
        });

        const resultado = await response.json();

        console.log('[excluirProdutoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            const erroLower = resultado.faultstring.toLowerCase();
            if (erroLower.includes('não encontrado') || erroLower.includes('não cadastrado') || erroLower.includes('not found')) {
                console.log('[excluirProdutoOmie] Produto já não existe no Omie (ignorando):', resultado.faultstring);
                return Response.json({
                    sucesso: true,
                    mensagem: 'Produto já não existia no Omie'
                });
            }

            console.error('[excluirProdutoOmie] Erro Omie:', resultado.faultstring);
            return Response.json({
                sucesso: false,
                erro: resultado.faultstring
            });
        }

        console.log('[excluirProdutoOmie] Produto excluído do Omie:', produtoNome);
        return Response.json({
            sucesso: true,
            mensagem: 'Produto excluído do Omie com sucesso'
        });

    } catch (error) {
        console.error('[excluirProdutoOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});