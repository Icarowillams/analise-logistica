import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Acesso restrito' }, { status: 403 });
        }

        const body = await req.json();
        const { acao } = body;

        // ==========================================
        // AÇÃO 1: DIAGNOSTICAR - Mostra duplicados
        // ==========================================
        if (acao === "diagnosticar") {
            const [precos, tabelas, produtos] = await Promise.all([
                base44.asServiceRole.entities.PrecoProduto.list(),
                base44.asServiceRole.entities.TabelaPreco.list(),
                base44.asServiceRole.entities.Produto.list()
            ]);

            const duplicados = [];
            const porTabela = {};

            // Agrupar preços por tabela
            for (const p of precos) {
                const key = p.tabela_id;
                if (!porTabela[key]) porTabela[key] = [];
                porTabela[key].push(p);
            }

            let totalDuplicados = 0;

            for (const tabelaId of Object.keys(porTabela)) {
                const precosTab = porTabela[tabelaId];
                const tabela = tabelas.find(t => t.id === tabelaId);

                // Encontrar produtos duplicados nesta tabela
                const prodCount = {};
                for (const p of precosTab) {
                    if (!prodCount[p.produto_id]) prodCount[p.produto_id] = [];
                    prodCount[p.produto_id].push(p);
                }

                for (const [prodId, lista] of Object.entries(prodCount)) {
                    if (lista.length > 1) {
                        const produto = produtos.find(pr => pr.id === prodId);
                        totalDuplicados += lista.length - 1;
                        duplicados.push({
                            tabela_nome: tabela?.nome || tabelaId,
                            tabela_id: tabelaId,
                            produto_nome: produto?.nome || prodId,
                            produto_codigo: produto?.codigo || '',
                            produto_id: prodId,
                            quantidade: lista.length,
                            ids_para_remover: lista.slice(1).map(p => p.id) // manter o primeiro, remover os demais
                        });
                    }
                }
            }

            // Contar produtos únicos em todas as tabelas
            const todosProdsUnicos = new Set();
            for (const p of precos) {
                todosProdsUnicos.add(p.produto_id);
            }

            return Response.json({
                sucesso: true,
                total_precos: precos.length,
                total_tabelas: tabelas.length,
                total_produtos_unicos: todosProdsUnicos.size,
                total_duplicados: totalDuplicados,
                duplicados,
                resumo_por_tabela: Object.entries(porTabela).map(([tId, lista]) => {
                    const tab = tabelas.find(t => t.id === tId);
                    const prodsUnicos = new Set(lista.map(p => p.produto_id));
                    return {
                        tabela_nome: tab?.nome || tId,
                        total_registros: lista.length,
                        produtos_unicos: prodsUnicos.size,
                        duplicados: lista.length - prodsUnicos.size
                    };
                })
            });
        }

        // ==========================================
        // AÇÃO 2: LIMPAR DUPLICADOS
        // ==========================================
        if (acao === "limpar_duplicados") {
            const [precos, tabelas, produtos] = await Promise.all([
                base44.asServiceRole.entities.PrecoProduto.list(),
                base44.asServiceRole.entities.TabelaPreco.list(),
                base44.asServiceRole.entities.Produto.list()
            ]);

            const porTabela = {};
            for (const p of precos) {
                if (!porTabela[p.tabela_id]) porTabela[p.tabela_id] = [];
                porTabela[p.tabela_id].push(p);
            }

            let removidos = 0;
            const detalhes = [];

            for (const tabelaId of Object.keys(porTabela)) {
                const precosTab = porTabela[tabelaId];
                const tabela = tabelas.find(t => t.id === tabelaId);

                const prodCount = {};
                for (const p of precosTab) {
                    if (!prodCount[p.produto_id]) prodCount[p.produto_id] = [];
                    prodCount[p.produto_id].push(p);
                }

                for (const [prodId, lista] of Object.entries(prodCount)) {
                    if (lista.length > 1) {
                        // Manter o que tem maior valor_unitario (ou o mais recente)
                        lista.sort((a, b) => (b.valor_unitario || 0) - (a.valor_unitario || 0));
                        const manter = lista[0];
                        const paraRemover = lista.slice(1);

                        for (const dup of paraRemover) {
                            await base44.asServiceRole.entities.PrecoProduto.delete(dup.id);
                            removidos++;
                        }

                        const produto = produtos.find(pr => pr.id === prodId);
                        detalhes.push({
                            tabela: tabela?.nome,
                            produto: produto?.nome,
                            codigo: produto?.codigo,
                            duplicados_removidos: paraRemover.length,
                            valor_mantido: manter.valor_unitario
                        });
                    }
                }
            }

            return Response.json({
                sucesso: true,
                removidos,
                detalhes
            });
        }

        // ==========================================
        // AÇÃO 3: CRIAR TABELA AUXILIAR
        // Consolida todos os produtos de todas as tabelas
        // Sem duplicatas, usando o maior preço encontrado
        // ==========================================
        if (acao === "criar_tabela_auxiliar") {
            const [precos, tabelas, produtos] = await Promise.all([
                base44.asServiceRole.entities.PrecoProduto.list(),
                base44.asServiceRole.entities.TabelaPreco.list(),
                base44.asServiceRole.entities.Produto.list()
            ]);

            // Verificar se já existe
            let tabelaAuxiliar = tabelas.find(t => t.nome === 'TABELA AUXILIAR');
            
            if (!tabelaAuxiliar) {
                tabelaAuxiliar = await base44.asServiceRole.entities.TabelaPreco.create({
                    nome: 'TABELA AUXILIAR',
                    status: 'ativo'
                });
                console.log(`Tabela Auxiliar criada: ${tabelaAuxiliar.id}`);
            } else {
                console.log(`Tabela Auxiliar já existe: ${tabelaAuxiliar.id}`);
            }

            // Buscar preços existentes na tabela auxiliar
            const precosAuxExistentes = precos.filter(p => p.tabela_id === tabelaAuxiliar.id);
            const mapaPrecosAux = {};
            for (const p of precosAuxExistentes) {
                mapaPrecosAux[p.produto_id] = p;
            }

            // Consolidar: para cada produto, pegar o maior valor entre todas as tabelas
            const consolidado = {};
            
            for (const preco of precos) {
                if (preco.tabela_id === tabelaAuxiliar.id) continue; // pular a própria auxiliar
                
                const prodId = preco.produto_id;
                const valor = (preco.ativacao_acao && preco.valor_acao > 0) 
                    ? preco.valor_acao 
                    : (preco.valor_unitario || 0);
                
                if (!consolidado[prodId] || valor > consolidado[prodId].valor) {
                    consolidado[prodId] = {
                        produto_id: prodId,
                        valor: valor
                    };
                }
            }

            // Também incluir produtos ativos que não estão em nenhuma tabela
            for (const prod of produtos) {
                if (prod.status === 'ativo' && !consolidado[prod.id]) {
                    consolidado[prod.id] = {
                        produto_id: prod.id,
                        valor: 0 // sem preço definido
                    };
                }
            }

            let criados = 0;
            let atualizados = 0;
            let ignorados = 0;

            for (const [prodId, info] of Object.entries(consolidado)) {
                const produto = produtos.find(p => p.id === prodId);
                if (!produto || produto.status !== 'ativo') {
                    ignorados++;
                    continue;
                }

                const existente = mapaPrecosAux[prodId];
                
                if (existente) {
                    // Atualizar se valor diferente
                    if (existente.valor_unitario !== info.valor && info.valor > 0) {
                        await base44.asServiceRole.entities.PrecoProduto.update(existente.id, {
                            valor_unitario: info.valor
                        });
                        atualizados++;
                    } else {
                        ignorados++;
                    }
                } else {
                    if (info.valor > 0) {
                        await base44.asServiceRole.entities.PrecoProduto.create({
                            produto_id: prodId,
                            tabela_id: tabelaAuxiliar.id,
                            valor_unitario: info.valor,
                            valor_acao: 0,
                            ativacao_acao: false
                        });
                        criados++;
                    } else {
                        // Produto sem preço em nenhuma tabela - criar com valor 0
                        await base44.asServiceRole.entities.PrecoProduto.create({
                            produto_id: prodId,
                            tabela_id: tabelaAuxiliar.id,
                            valor_unitario: 0,
                            valor_acao: 0,
                            ativacao_acao: false
                        });
                        criados++;
                    }
                }
            }

            return Response.json({
                sucesso: true,
                tabela_auxiliar_id: tabelaAuxiliar.id,
                total_produtos: Object.keys(consolidado).length,
                criados,
                atualizados,
                ignorados,
                mensagem: `Tabela Auxiliar pronta com ${Object.keys(consolidado).length} produtos únicos. ${criados} criados, ${atualizados} atualizados.`
            });
        }

        return Response.json({ error: `Ação "${acao}" não reconhecida` }, { status: 400 });
    } catch (error) {
        console.error(`[FATAL] ${error.message}`);
        return Response.json({ error: error.message }, { status: 500 });
    }
});