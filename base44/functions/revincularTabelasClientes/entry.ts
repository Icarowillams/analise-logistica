import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Buscar todas as tabelas de preço atuais
        const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
        const tabelaPorNome = {};
        tabelas.forEach(t => {
            tabelaPorNome[t.nome.trim().toUpperCase()] = t.id;
        });

        // Buscar clientes SEM tabela
        let allClientes = [];
        let offset = 0;
        const batchSize = 500;
        while (true) {
            const batch = await base44.asServiceRole.entities.Cliente.list('-created_date', batchSize, offset);
            if (!batch || batch.length === 0) break;
            allClientes = allClientes.concat(batch);
            if (batch.length < batchSize) break;
            offset += batchSize;
        }

        const clientesSemTabela = allClientes.filter(c => !c.tabela_id || c.tabela_id.trim() === '');
        console.log(`Clientes sem tabela: ${clientesSemTabela.length}`);

        if (clientesSemTabela.length === 0) {
            return Response.json({ sucesso: true, mensagem: 'Nenhum cliente sem tabela encontrado.' });
        }

        // Buscar tabelas de preço do Omie para mapear nCodTabPreco -> nome
        let tabelasOmie = [];
        try {
            const resTabelasOmie = await fetch("https://app.omie.com.br/api/v1/produtos/tabelaprecos/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ListarTabelasPreco",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{ nPagina: 1, nRegPorPagina: 200 }]
                })
            });
            const dataTabelasOmie = await resTabelasOmie.json();
            tabelasOmie = dataTabelasOmie.listaTabelasPreco || dataTabelasOmie.lista_tabelas_preco || [];
            console.log(`Tabelas Omie encontradas: ${tabelasOmie.length}`);
        } catch (err) {
            console.error('Erro ao buscar tabelas Omie:', err.message);
        }

        // Mapa de nCodTabPreco -> nome da tabela Omie
        const omieTabPorCodigo = {};
        tabelasOmie.forEach(t => {
            const codigo = t.nCodTabPreco || t.codigo;
            const nome = t.cNome || t.nome || '';
            if (codigo && nome) {
                omieTabPorCodigo[codigo] = nome.trim().toUpperCase();
            }
        });

        // Para cada cliente sem tabela, buscar no Omie qual tabela tem
        let corrigidos = 0;
        let naoEncontradosOmie = 0;
        let semTabelaOmie = 0;
        let tabelaNaoMapeada = [];
        let erros = [];

        // Processar em lotes de 5 (para não sobrecarregar API Omie)
        for (let i = 0; i < clientesSemTabela.length; i++) {
            const cliente = clientesSemTabela[i];
            
            // Tentar consultar cliente no Omie
            const codigoIntegracao = cliente.codigo || cliente.id;
            
            try {
                // Delay para não exceder rate limit
                if (i > 0 && i % 5 === 0) {
                    await new Promise(r => setTimeout(r, 1000));
                }

                const resOmie = await fetch("https://app.omie.com.br/api/v1/geral/clientes/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: "ConsultarCliente",
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{ codigo_cliente_integracao: codigoIntegracao }]
                    })
                });

                const clienteOmie = await resOmie.json();

                if (clienteOmie.faultstring) {
                    // Tentar pelo ID do Base44
                    if (codigoIntegracao !== cliente.id) {
                        const resOmie2 = await fetch("https://app.omie.com.br/api/v1/geral/clientes/", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                call: "ConsultarCliente",
                                app_key: OMIE_APP_KEY,
                                app_secret: OMIE_APP_SECRET,
                                param: [{ codigo_cliente_integracao: cliente.id }]
                            })
                        });
                        const clienteOmie2 = await resOmie2.json();
                        if (clienteOmie2.faultstring) {
                            naoEncontradosOmie++;
                            continue;
                        }
                        // Processar clienteOmie2
                        const nCodTabPreco = clienteOmie2.recomendacoes?.numero_tabela_preco;
                        if (!nCodTabPreco) {
                            semTabelaOmie++;
                            continue;
                        }
                        const nomeTabelaOmie = omieTabPorCodigo[nCodTabPreco];
                        if (!nomeTabelaOmie) {
                            semTabelaOmie++;
                            continue;
                        }
                        const novaTabId = tabelaPorNome[nomeTabelaOmie];
                        if (!novaTabId) {
                            tabelaNaoMapeada.push({ codigo: cliente.codigo, tabela_omie: nomeTabelaOmie });
                            continue;
                        }
                        await base44.asServiceRole.entities.Cliente.update(cliente.id, { tabela_id: novaTabId });
                        corrigidos++;
                        continue;
                    }
                    naoEncontradosOmie++;
                    continue;
                }

                // Cliente encontrado no Omie - verificar tabela de preço
                const nCodTabPreco = clienteOmie.recomendacoes?.numero_tabela_preco;
                if (!nCodTabPreco) {
                    semTabelaOmie++;
                    continue;
                }

                const nomeTabelaOmie = omieTabPorCodigo[nCodTabPreco];
                if (!nomeTabelaOmie) {
                    semTabelaOmie++;
                    continue;
                }

                // Tentar encontrar a tabela correspondente no Base44 pelo nome
                const novaTabId = tabelaPorNome[nomeTabelaOmie];
                if (!novaTabId) {
                    tabelaNaoMapeada.push({ codigo: cliente.codigo, tabela_omie: nomeTabelaOmie });
                    continue;
                }

                // Atualizar o cliente com a nova tabela
                await base44.asServiceRole.entities.Cliente.update(cliente.id, { tabela_id: novaTabId });
                corrigidos++;

            } catch (err) {
                erros.push({ codigo: cliente.codigo, erro: err.message });
            }
        }

        console.log(`Corrigidos: ${corrigidos}, Não encontrados Omie: ${naoEncontradosOmie}, Sem tabela Omie: ${semTabelaOmie}, Não mapeadas: ${tabelaNaoMapeada.length}, Erros: ${erros.length}`);

        return Response.json({
            sucesso: true,
            total_sem_tabela: clientesSemTabela.length,
            corrigidos,
            nao_encontrados_omie: naoEncontradosOmie,
            sem_tabela_no_omie: semTabelaOmie,
            tabelas_nao_mapeadas: tabelaNaoMapeada.slice(0, 30),
            erros: erros.length,
            detalhes_erros: erros.slice(0, 10),
            mensagem: `${corrigidos} clientes re-vinculados com sucesso!`
        });

    } catch (error) {
        console.error('Erro geral:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});