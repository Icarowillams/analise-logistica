import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const dryRun = body.dry_run !== false; // default true = só mostra, não altera

        // Buscar todas as tabelas de preço atuais
        const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
        const tabelaIdsValidos = new Set(tabelas.map(t => t.id));
        
        // Mapa de nome -> id das tabelas atuais (lowercase para matching)
        const tabelaPorNome = {};
        tabelas.forEach(t => {
            tabelaPorNome[t.nome.trim().toLowerCase()] = t.id;
        });

        // Buscar TODOS os clientes (em lotes)
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

        console.log(`Total de clientes: ${allClientes.length}`);
        console.log(`Tabelas válidas: ${tabelaIdsValidos.size}`);

        // Identificar clientes com tabela_id órfão
        const clientesOrfaos = allClientes.filter(c => 
            c.tabela_id && !tabelaIdsValidos.has(c.tabela_id)
        );

        console.log(`Clientes com tabela_id órfão: ${clientesOrfaos.length}`);

        // Agrupar IDs órfãos antigos para entender a distribuição
        const idsOrfaos = {};
        clientesOrfaos.forEach(c => {
            idsOrfaos[c.tabela_id] = (idsOrfaos[c.tabela_id] || 0) + 1;
        });

        if (dryRun) {
            return Response.json({
                sucesso: true,
                modo: 'dry_run',
                total_clientes: allClientes.length,
                total_tabelas_validas: tabelaIdsValidos.size,
                clientes_com_tabela_orfao: clientesOrfaos.length,
                distribuicao_ids_orfaos: idsOrfaos,
                tabelas_atuais: tabelas.map(t => ({ id: t.id, nome: t.nome })),
                mensagem: 'Execute com dry_run=false para corrigir (limpará tabela_id dos clientes órfãos)'
            });
        }

        // Modo execução: limpar tabela_id dos clientes órfãos
        let corrigidos = 0;
        let erros = [];

        for (const cliente of clientesOrfaos) {
            try {
                await base44.asServiceRole.entities.Cliente.update(cliente.id, {
                    tabela_id: ''
                });
                corrigidos++;
            } catch (err) {
                erros.push({ id: cliente.id, codigo: cliente.codigo, erro: err.message });
            }
        }

        console.log(`Corrigidos: ${corrigidos}, Erros: ${erros.length}`);

        return Response.json({
            sucesso: true,
            modo: 'execucao',
            total_clientes: allClientes.length,
            clientes_com_tabela_orfao: clientesOrfaos.length,
            corrigidos,
            erros: erros.length,
            detalhes_erros: erros.slice(0, 20),
            mensagem: `${corrigidos} clientes tiveram o campo tabela_id limpo. Agora aparecem no filtro "Sem Tabela" para re-vinculação.`
        });

    } catch (error) {
        console.error('Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});