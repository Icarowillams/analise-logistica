import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL_LISTAR = "https://app.omie.com.br/api/v1/geral/produtos/";
const OMIE_URL_ALTERAR = "https://app.omie.com.br/api/v1/geral/produtos/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json();
        const mode = body.mode || 'compare'; // 'compare' or 'sync'

        // 1. Buscar produtos do Omie (todos)
        let pagina = 1;
        let totalPaginas = 1;
        const produtosOmie = [];

        while (pagina <= totalPaginas) {
            const response = await fetch(OMIE_URL_LISTAR, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ListarProdutos",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{
                        pagina,
                        registros_por_pagina: 500,
                        apenas_importado_api: "N",
                        filtrar_apenas_omiepdv: "N"
                    }]
                })
            });
            const data = await response.json();
            if (data.faultstring) {
                return Response.json({ error: data.faultstring }, { status: 400 });
            }
            totalPaginas = data.total_de_paginas || 1;
            const lista = data.produto_servico_cadastro || [];
            for (const p of lista) {
                produtosOmie.push({
                    codigo: p.codigo || '',
                    codigo_produto: p.codigo_produto || null,
                    descricao: p.descricao || '',
                    ncm: p.ncm || '',
                    ean: p.ean || '',
                    unidade: p.unidade || '',
                    peso_liq: p.peso_liq || 0,
                    peso_bruto: p.peso_bruto || 0,
                    inativo: p.inativo === 'S',
                });
            }
            pagina++;
            await new Promise(r => setTimeout(r, 500));
        }

        // 2. Buscar produtos locais
        const produtosLocais = await base44.asServiceRole.entities.Produto.list('-created_date', 5000);

        // Index Omie por código
        const omieMap = {};
        produtosOmie.forEach(p => { omieMap[p.codigo] = p; });

        // 3. Comparar e identificar divergências
        const divergencias = [];
        const semCorrespondencia = [];
        const iguais = [];

        for (const local of produtosLocais) {
            if (local.status === 'inativo') continue;
            
            const omie = omieMap[local.codigo];
            if (!omie) {
                semCorrespondencia.push({
                    codigo: local.codigo,
                    nome_local: local.nome,
                    acao: 'PRODUTO NAO EXISTE NO OMIE COM ESTE CODIGO'
                });
                continue;
            }

            const nomeLocal = (local.nome || '').toUpperCase().trim();
            const nomeOmie = (omie.descricao || '').toUpperCase().trim();

            if (nomeLocal !== nomeOmie) {
                divergencias.push({
                    codigo: local.codigo,
                    codigo_produto_omie: omie.codigo_produto,
                    nome_local: local.nome,
                    nome_omie: omie.descricao,
                    ncm_local: local.ncm || '',
                    acao: mode === 'sync' ? 'SERA ATUALIZADO NO OMIE' : 'NOME DIFERENTE'
                });
            } else {
                iguais.push({
                    codigo: local.codigo,
                    nome: local.nome,
                });
            }
        }

        // 4. Se mode === 'sync', atualizar os divergentes no Omie
        let atualizados = 0;
        let erros = 0;
        const resultados = [];

        if (mode === 'sync') {
            for (const div of divergencias) {
                const local = produtosLocais.find(p => p.codigo === div.codigo);
                if (!local) continue;

                const payload = {
                    codigo_produto: div.codigo_produto_omie,
                    codigo: div.codigo,
                    descricao: local.nome,
                };

                // Atualizar NCM se tiver
                if (local.ncm) payload.ncm = local.ncm;

                console.log(`[sync] Atualizando Omie código ${div.codigo}: "${div.nome_omie}" → "${local.nome}"`);

                const response = await fetch(OMIE_URL_ALTERAR, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: "AlterarProduto",
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [payload]
                    })
                });

                const result = await response.json();

                if (result.faultstring) {
                    console.error(`[sync] Erro ao atualizar código ${div.codigo}: ${result.faultstring}`);
                    resultados.push({ codigo: div.codigo, sucesso: false, erro: result.faultstring });
                    erros++;
                } else {
                    console.log(`[sync] OK: código ${div.codigo} atualizado`);
                    resultados.push({ codigo: div.codigo, sucesso: true });
                    atualizados++;
                }

                // Rate limit Omie
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        return Response.json({
            sucesso: true,
            mode,
            stats: {
                total_local_ativos: produtosLocais.filter(p => p.status === 'ativo').length,
                total_omie: produtosOmie.length,
                iguais: iguais.length,
                divergentes: divergencias.length,
                sem_correspondencia: semCorrespondencia.length,
                ...(mode === 'sync' ? { atualizados, erros } : {})
            },
            divergencias,
            sem_correspondencia: semCorrespondencia,
            ...(mode === 'sync' ? { resultados } : {})
        });

    } catch (error) {
        console.error('[exportarProdutosDaquiParaOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});