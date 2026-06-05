import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_CATEGORIAS_URL = 'https://app.omie.com.br/api/v1/geral/categorias/';

async function chamarOmie(payload) {
    const appKey = Deno.env.get('OMIE_APP_KEY');
    const appSecret = Deno.env.get('OMIE_APP_SECRET');

    if (!appKey || !appSecret) {
        throw new Error('Credenciais Omie não configuradas');
    }

    const response = await fetch(OMIE_CATEGORIAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...payload,
            app_key: appKey,
            app_secret: appSecret
        })
    });

    const data = await response.json();
    if (data?.faultstring) {
        throw new Error(data.faultstring);
    }
    return data;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const codigo = body.codigo ? String(body.codigo) : null;
        const registrosPorPagina = Math.min(Number(body.registros_por_pagina || 100), 500);
        let pagina = 1;
        let totalPaginas = 1;
        const categorias = [];

        do {
            const param = {
                pagina,
                registros_por_pagina: registrosPorPagina
            };

            if (codigo) {
                param.filtrar_por_codigo = codigo;
            }

            const data = await chamarOmie({
                call: 'ListarCategorias',
                param: [param]
            });

            const lista = data.categoria_cadastro || data.categorias || [];
            categorias.push(...lista.map((categoria) => ({
                codigo: categoria.codigo || categoria.codigo_categoria,
                descricao: categoria.descricao || categoria.descricao_categoria,
                inativa: categoria.conta_inativa === 'S' || categoria.inativa === 'S',
                conta_despesa: categoria.conta_despesa,
                conta_receita: categoria.conta_receita
            })));

            totalPaginas = Number(data.total_de_paginas || data.total_paginas || 1);
            pagina += 1;
        } while (!codigo && pagina <= totalPaginas && categorias.length < 1000);

        return Response.json({ total: categorias.length, categorias });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});