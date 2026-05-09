import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const codigos = body.codigos || [];

        if (codigos.length === 0) {
            return Response.json({ error: 'Informe codigos[]' }, { status: 400 });
        }

        const resultados = {};

        for (const codigo of codigos) {
            const response = await fetch("https://app.omie.com.br/api/v1/geral/produtos/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ConsultarProduto",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{ codigo }]
                })
            });

            const data = await response.json();

            if (data.faultstring) {
                resultados[codigo] = { erro: data.faultstring };
            } else {
                resultados[codigo] = {
                    codigo: data.codigo,
                    codigo_produto: data.codigo_produto,
                    descricao: data.descricao,
                    ncm: data.ncm,
                    ean: data.ean,
                    unidade: data.unidade,
                    valor_unitario: data.valor_unitario,
                    peso_liq: data.peso_liq,
                    peso_bruto: data.peso_bruto,
                    cfop: data.cfop || null,
                    csosn: data.csosn || null,
                    cst_icms: data.cst_icms || null,
                    cst_pis: data.cst_pis || null,
                    cst_cofins: data.cst_cofins || null,
                    cst_ipi: data.cst_ipi || null,
                    origem_mercadoria: data.origem_mercadoria || null,
                    tipo_item: data.tipo_item || null,
                    inativo: data.inativo,
                    tipoItem: data.tipoItem || null,
                    recomendacoes_fiscais: data.recomendacoes_fiscais || null,
                    modalidade_icms: data.modalidade_icms || null,
                    csosn_icms: data.csosn_icms || null,
                    aliquota_icms: data.aliquota_icms || null,
                    codigo_beneficio: data.codigo_beneficio || null,
                    dadosIbpt: data.dadosIbpt || null,
                    bloqueado: data.bloqueado || null,
                    // Raw completo para comparação
                    _raw: data,
                };
            }

            await new Promise(r => setTimeout(r, 600));
        }

        return Response.json({ sucesso: true, resultados });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});