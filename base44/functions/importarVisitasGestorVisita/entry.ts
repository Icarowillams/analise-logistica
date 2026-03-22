import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const GESTOR_VISITA_APP_ID = '68b1f50209adbcb52b0d911b';
const GESTOR_VISITA_API_KEY = '60cf11f680fa4a83b1631326d3c773b1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const resultado = {
            success: true,
            visitas_importadas: 0,
            estoques_importados: 0,
            trocas_importadas: 0,
            qualidade_trocas_importadas: 0,
            total_visitas_buscadas: 0,
            total_estoques_buscados: 0,
            total_trocas_buscadas: 0,
            total_qualidade_trocas_buscadas: 0,
            duplicatas_ignoradas: 0,
            erros: []
        };

        // Buscar TODOS os registros existentes para evitar duplicatas
        const [visitasExistentes, estoquesExistentes, trocasExistentes] = await Promise.all([
            base44.asServiceRole.entities.RelatorioVisita.filter({ origem_app_id: GESTOR_VISITA_APP_ID }),
            base44.asServiceRole.entities.RelatorioEstoque.filter({ origem_app_id: GESTOR_VISITA_APP_ID }),
            base44.asServiceRole.entities.RelatorioTroca.filter({ origem_app_id: GESTOR_VISITA_APP_ID })
        ]);

        // Criar Sets com IDs já importados
        const visitasJaImportadas = new Set(visitasExistentes.map(v => v.origem_visita_id));
        const estoquesJaImportados = new Set(estoquesExistentes.map(e => e.origem_estoque_id));
        const trocasJaImportadas = new Set(trocasExistentes.map(t => t.origem_troca_id));

        // Buscar apenas registros dos últimos 7 dias para otimizar
        const dataLimite = new Date();
        dataLimite.setDate(dataLimite.getDate() - 7);
        const dataLimiteISO = dataLimite.toISOString();

        const fetchRecentRecords = async (entityName, dateField = 'created_date') => {
            const response = await fetch(
                `https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/${entityName}?limit=500&sort=-${dateField}`,
                { headers: { 'api_key': GESTOR_VISITA_API_KEY } }
            );
            return await response.json();
        };

        // Buscar entidades recentes e dados de referência
        const [visitas, estoques, trocas, clientes, produtos, funcionarios, motivos] = await Promise.all([
            fetchRecentRecords('Visita', 'checkin_time'),
            fetchRecentRecords('EstoqueVisita', 'created_date'),
            fetchRecentRecords('TrocaVisita', 'created_date'),
            fetchRecentRecords('Cliente', 'created_date'),
            fetchRecentRecords('Produto', 'created_date'),
            fetchRecentRecords('Funcionario', 'created_date'),
            fetchRecentRecords('MotivoTroca', 'created_date')
        ]);

        // Log de quantidades buscadas
        resultado.total_visitas_buscadas = visitas.length;
        resultado.total_estoques_buscados = estoques.length;
        resultado.total_trocas_buscadas = trocas.length;

        // Mapear para fácil acesso
        const clientesMap = Object.fromEntries(clientes.map(c => [c.id, c]));
        const produtosMap = Object.fromEntries(produtos.map(p => [p.id, p]));
        const funcionariosMap = Object.fromEntries(funcionarios.map(f => [f.id, f]));
        const motivosMap = Object.fromEntries(motivos.map(m => [m.id, m]));

        // Importar em lotes (batch) com delay para evitar rate limit
        const BATCH_SIZE = 30;
        const DELAY_MS = 1500; // 1.5 segundos entre lotes para garantir estabilidade
        
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        // Importar Visitas em lotes (apenas novas)
        const visitasParaImportar = [];
        for (const visita of visitas) {
            // Ignorar se já foi importada
            if (visitasJaImportadas.has(visita.id)) {
                resultado.duplicatas_ignoradas++;
                continue;
            }

            const cliente = clientesMap[visita.cliente_id];
            const promotor = funcionariosMap[visita.promotor_id];

            visitasParaImportar.push({
                origem_app_id: GESTOR_VISITA_APP_ID,
                origem_visita_id: visita.id,
                cliente_nome: cliente?.nome_fantasia || cliente?.razao_social || 'N/A',
                cliente_codigo: cliente?.codigo_interno || cliente?.codigo || 'N/A',
                cliente_cidade: cliente?.cidade || null,
                cliente_uf: cliente?.uf || null,
                cliente_segmento: cliente?.segmento || null,
                promotor_nome: promotor?.nome_completo || promotor?.nome || 'Sem Promotor',
                promotor_funcao: promotor?.funcao || null,
                data_visita: visita.checkin_time || new Date().toISOString(),
                checkin_time: visita.checkin_time,
                checkout_time: visita.checkout_time,
                status: visita.status || 'realizada',
                justificativa_nao_atendimento: visita.justificativa_nao_atendimento,
                pedido_solicitado: visita.pedido_solicitado || false,
                motivo_nao_solicitacao: visita.motivo_nao_solicitacao_pedido,
                dia_semana: visita.checkin_time ? new Date(visita.checkin_time).toLocaleDateString('pt-BR', { weekday: 'long' }) : null
            });
        }

        // Criar visitas em lotes com delay
        for (let i = 0; i < visitasParaImportar.length; i += BATCH_SIZE) {
            const batch = visitasParaImportar.slice(i, i + BATCH_SIZE);
            try {
                await base44.asServiceRole.entities.RelatorioVisita.bulkCreate(batch);
                resultado.visitas_importadas += batch.length;
                if (i + BATCH_SIZE < visitasParaImportar.length) {
                    await sleep(DELAY_MS);
                }
            } catch (error) {
                resultado.erros.push({ tipo: 'visita_batch', lote: i, erro: error.message });
                await sleep(DELAY_MS * 2); // delay maior em caso de erro
            }
        }

        // Importar Estoques em lotes (apenas novos)
        const estoquesParaImportar = [];
        for (const estoque of estoques) {
            // Ignorar se já foi importado
            if (estoquesJaImportados.has(estoque.id)) {
                resultado.duplicatas_ignoradas++;
                continue;
            }

            const produto = produtosMap[estoque.produto_id];
            const visita = visitas.find(v => v.id === estoque.visita_id);
            const cliente = clientesMap[visita?.cliente_id];
            const promotor = funcionariosMap[visita?.promotor_id];

            estoquesParaImportar.push({
                origem_app_id: GESTOR_VISITA_APP_ID,
                origem_estoque_id: estoque.id,
                origem_visita_id: estoque.visita_id,
                cliente_nome: cliente?.nome_fantasia || cliente?.razao_social || 'N/A',
                cliente_codigo: cliente?.codigo_interno || cliente?.codigo || 'N/A',
                produto_codigo: produto?.codigo || 'N/A',
                produto_descricao: produto?.descricao || produto?.nome || 'N/A',
                produto_gramatura: produto?.gramatura || null,
                quantidade: estoque.quantidade || 0,
                data_validade: estoque.data_validade || null,
                data_fabricacao: estoque.data_fabricacao || null,
                horario_fabricacao: estoque.horario_fabricacao || null,
                data_registro: estoque.created_date || new Date().toISOString(),
                promotor_nome: promotor?.nome_completo || promotor?.nome || 'Sem Promotor'
            });
        }

        for (let i = 0; i < estoquesParaImportar.length; i += BATCH_SIZE) {
            const batch = estoquesParaImportar.slice(i, i + BATCH_SIZE);
            try {
                await base44.asServiceRole.entities.RelatorioEstoque.bulkCreate(batch);
                resultado.estoques_importados += batch.length;
                if (i + BATCH_SIZE < estoquesParaImportar.length) {
                    await sleep(DELAY_MS);
                }
            } catch (error) {
                resultado.erros.push({ tipo: 'estoque_batch', lote: i, erro: error.message });
                await sleep(DELAY_MS * 2); // delay maior em caso de erro
            }
        }

        // Importar Trocas em lotes (apenas novas)
        const trocasParaImportar = [];
        
        // Criar um Map de visitas para lookup mais rápido
        const visitasMap = Object.fromEntries(visitas.map(v => [v.id, v]));
        
        for (const troca of trocas) {
            // Ignorar se já foi importada
            if (trocasJaImportadas.has(troca.id)) {
                resultado.duplicatas_ignoradas++;
                continue;
            }

            try {
                const produto = produtosMap[troca.produto_id];
                const motivo = motivosMap[troca.motivo_troca_id];
                const visita = visitasMap[troca.visita_id];
                const cliente = clientesMap[visita?.cliente_id];
                const promotor = funcionariosMap[visita?.promotor_id];

                let diasVidaUtil = null;
                if (troca.data_validade && troca.data_fabricacao) {
                    const dataVal = new Date(troca.data_validade);
                    const dataFab = new Date(troca.data_fabricacao);
                    const diffDias = Math.floor((dataVal - dataFab) / (1000 * 60 * 60 * 24));
                    diasVidaUtil = 25 - diffDias;
                }

                trocasParaImportar.push({
                    origem_app_id: GESTOR_VISITA_APP_ID,
                    origem_troca_id: troca.id,
                    origem_visita_id: troca.visita_id || '',
                    cliente_nome: cliente?.nome_fantasia || cliente?.razao_social || 'N/A',
                    cliente_codigo: cliente?.codigo_interno || cliente?.codigo || 'N/A',
                    produto_codigo: produto?.codigo || 'N/A',
                    produto_descricao: produto?.descricao || produto?.nome || troca.produto_descricao || 'N/A',
                    motivo_troca: motivo?.motivo || motivo?.descricao || 'N/A',
                    quantidade: troca.quantidade || 0,
                    data_validade: troca.data_validade || null,
                    data_fabricacao: troca.data_fabricacao || null,
                    horario_fabricacao: troca.horario_fabricacao || null,
                    ja_informado_anteriormente: troca.ja_informado_anteriormente || false,
                    foto_url: troca.foto_url || null,
                    data_registro: troca.created_date || new Date().toISOString(),
                    promotor_nome: promotor?.nome_completo || promotor?.nome || 'Sem Promotor',
                    dias_vida_util: diasVidaUtil
                });
            } catch (error) {
                resultado.erros.push({ 
                    tipo: 'troca_processamento', 
                    id: troca.id, 
                    erro: error.message 
                });
            }
        }

        for (let i = 0; i < trocasParaImportar.length; i += BATCH_SIZE) {
            const batch = trocasParaImportar.slice(i, i + BATCH_SIZE);
            try {
                await base44.asServiceRole.entities.RelatorioTroca.bulkCreate(batch);
                resultado.trocas_importadas += batch.length;
                if (i + BATCH_SIZE < trocasParaImportar.length) {
                    await sleep(DELAY_MS);
                }
            } catch (error) {
                resultado.erros.push({ 
                    tipo: 'troca_batch', 
                    lote: i, 
                    erro: error.message
                });
                await sleep(DELAY_MS * 2); // delay maior em caso de erro
            }
        }

        // Atualizar ConfiguracaoImportacao
        const configsExistentes = await base44.asServiceRole.entities.ConfiguracaoImportacao.filter({
            app_origem_id: GESTOR_VISITA_APP_ID
        });

        if (configsExistentes.length > 0) {
            const config = configsExistentes[0];
            await base44.asServiceRole.entities.ConfiguracaoImportacao.update(config.id, {
                ultima_importacao: new Date().toISOString(),
                total_visitas_importadas: visitasExistentes.length + resultado.visitas_importadas,
                total_estoques_importados: estoquesExistentes.length + resultado.estoques_importados,
                total_trocas_importadas: trocasExistentes.length + resultado.trocas_importadas
            });
        } else {
            await base44.asServiceRole.entities.ConfiguracaoImportacao.create({
                app_origem_id: GESTOR_VISITA_APP_ID,
                app_origem_nome: 'Pão e Mel Gestor Visita',
                ultima_importacao: new Date().toISOString(),
                total_visitas_importadas: resultado.visitas_importadas,
                total_estoques_importados: resultado.estoques_importados,
                total_trocas_importadas: resultado.trocas_importadas,
                status: 'ativo'
            });
        }

        return Response.json({
            ...resultado,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        return Response.json({ 
            success: false,
            error: error.message
        }, { status: 500 });
    }
});