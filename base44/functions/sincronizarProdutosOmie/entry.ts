import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/produtos/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json();
        const mode = body.mode || 'compare'; // 'compare' or 'sync'

        // Doc Omie: máx 100 reg/pág, 4 paralelas, 240 req/min. Backoff em 425/520.
        async function listarPagina(pag, tent = 0) {
            const response = await fetch(OMIE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ListarProdutos",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{
                        pagina: pag,
                        registros_por_pagina: 100,
                        apenas_importado_api: "N",
                        filtrar_apenas_omiepdv: "N"
                    }]
                })
            });
            const data = await response.json();
            if (data.faultstring) {
                const msg = String(data.faultstring).toLowerCase();
                const fc = String(data.faultcode || '');
                const isRate = msg.includes('limite de requisi') || msg.includes('cota') || msg.includes('aguarde')
                    || fc.includes('425') || fc.includes('520') || response.status === 429;
                if (isRate && tent < 4) {
                    await new Promise(r => setTimeout(r, 2000 * (tent + 1)));
                    return listarPagina(pag, tent + 1);
                }
                throw new Error(data.faultstring);
            }
            return data;
        }

        const produtosOmie = [];
        const PARALELISMO = 3;

        // Primeira página → descobre total
        const primeira = await listarPagina(1);
        const totalPaginas = primeira.total_de_paginas || 1;
        const pushLista = (lista) => {
            for (const p of lista || []) {
                produtosOmie.push({
                    codigo: p.codigo || '',
                    descricao: p.descricao || '',
                    codigo_produto_integracao: p.codigo_produto_integracao || '',
                    codigo_produto: p.codigo_produto || null,
                    ncm: p.ncm || '',
                    ean: p.ean || '',
                    unidade: p.unidade || '',
                    peso_liq: p.peso_liq || 0,
                    peso_bruto: p.peso_bruto || 0,
                    inativo: p.inativo === 'S',
                });
            }
        };
        pushLista(primeira.produto_servico_cadastro);

        // Demais páginas em lotes paralelos
        const paginasRestantes = [];
        for (let p = 2; p <= totalPaginas; p++) paginasRestantes.push(p);
        for (let i = 0; i < paginasRestantes.length; i += PARALELISMO) {
            const lote = paginasRestantes.slice(i, i + PARALELISMO);
            const resultados = await Promise.all(lote.map(p => listarPagina(p)));
            resultados.forEach(r => pushLista(r.produto_servico_cadastro));
            if (i + PARALELISMO < paginasRestantes.length) {
                await new Promise(r => setTimeout(r, 1000)); // respeita 240 req/min
            }
        }

        console.log(`[sincronizarProdutosOmie] Total produtos Omie: ${produtosOmie.length}`);

        // Buscar produtos locais
        const produtosLocais = await base44.asServiceRole.entities.Produto.list('-created_date', 5000);

        // Comparar: para cada produto local, verificar se o código bate com o Omie
        const comparacao = [];
        const produtosOmieMap = {};
        produtosOmie.forEach(p => {
            produtosOmieMap[p.codigo] = p;
        });

        for (const local of produtosLocais) {
            const omie = produtosOmieMap[local.codigo];
            
            const item = {
                id: local.id,
                codigo_local: local.codigo,
                nome_local: local.nome,
                status_local: local.status,
            };

            if (omie) {
                item.codigo_omie = omie.codigo;
                item.nome_omie = omie.descricao;
                item.match = true;
                // Verificar se o nome é compatível
                const nomeLocalNorm = (local.nome || '').toUpperCase().trim();
                const nomeOmieNorm = (omie.descricao || '').toUpperCase().trim();
                item.nome_igual = nomeLocalNorm === nomeOmieNorm;
                item.inativo_omie = omie.inativo;
            } else {
                item.match = false;
                item.codigo_omie = null;
                item.nome_omie = null;
                item.nome_igual = false;
                item.inativo_omie = false;
                
                // Tentar encontrar por nome similar no Omie
                const nomeLocalNorm = (local.nome || '').toUpperCase().trim();
                const possivelMatch = produtosOmie.find(o => 
                    (o.descricao || '').toUpperCase().trim() === nomeLocalNorm
                );
                if (possivelMatch) {
                    item.sugestao_codigo_omie = possivelMatch.codigo;
                    item.sugestao_nome_omie = possivelMatch.descricao;
                }
            }

            comparacao.push(item);
        }

        // Produtos no Omie que não existem localmente
        const codigosLocais = new Set(produtosLocais.map(p => p.codigo));
        const apenasOmie = produtosOmie
            .filter(p => !codigosLocais.has(p.codigo) && !p.inativo)
            .map(p => ({
                codigo_omie: p.codigo,
                nome_omie: p.descricao,
            }));

        // Se mode === 'sync', corrigir os códigos automaticamente
        let corrigidos = 0;
        let duplicatasRemovidas = 0;
        if (mode === 'sync') {
            for (const item of comparacao) {
                // Se não encontrou match por código mas encontrou sugestão por nome
                if (!item.match && item.sugestao_codigo_omie) {
                    console.log(`[sync] Corrigindo código: ${item.codigo_local} → ${item.sugestao_codigo_omie} (${item.nome_local})`);
                    await base44.asServiceRole.entities.Produto.update(item.id, {
                        codigo: item.sugestao_codigo_omie
                    });
                    corrigidos++;
                }
            }

            // Detectar e desativar duplicatas (mesmo nome, códigos diferentes)
            const nomesVisto = {};
            const sortedComparacao = [...comparacao].sort((a, b) => {
                // Priorizar os que têm match com Omie
                if (a.match && !b.match) return -1;
                if (!a.match && b.match) return 1;
                return 0;
            });

            for (const item of sortedComparacao) {
                const nomeNorm = (item.nome_local || '').toUpperCase().trim();
                if (nomesVisto[nomeNorm]) {
                    // Duplicata - desativar se o outro tem match e este não
                    if (!item.match && nomesVisto[nomeNorm].match) {
                        console.log(`[sync] Desativando duplicata: ${item.codigo_local} - ${item.nome_local} (mantendo ${nomesVisto[nomeNorm].codigo_local})`);
                        await base44.asServiceRole.entities.Produto.update(item.id, { status: 'inativo' });
                        duplicatasRemovidas++;
                    }
                } else {
                    nomesVisto[nomeNorm] = item;
                }
            }
        }

        // Estatísticas
        const stats = {
            total_local: produtosLocais.length,
            total_omie: produtosOmie.length,
            com_match: comparacao.filter(c => c.match).length,
            sem_match: comparacao.filter(c => !c.match).length,
            nome_diferente: comparacao.filter(c => c.match && !c.nome_igual).length,
            sugestao_encontrada: comparacao.filter(c => !c.match && c.sugestao_codigo_omie).length,
            apenas_no_omie: apenasOmie.length,
        };

        if (mode === 'sync') {
            stats.corrigidos = corrigidos;
            stats.duplicatas_removidas = duplicatasRemovidas;
        }

        return Response.json({
            sucesso: true,
            mode,
            stats,
            comparacao,
            apenas_omie: apenasOmie,
            produtos_omie: produtosOmie
        });

    } catch (error) {
        console.error('[sincronizarProdutosOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});