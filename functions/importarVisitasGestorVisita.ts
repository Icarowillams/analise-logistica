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
            total_visitas_buscadas: 0,
            total_estoques_buscados: 0,
            total_trocas_buscadas: 0,
            erros: []
        };

        // Buscar TODOS os dados em paralelo (limite muito alto)
        const [visitasRes, estoquesRes, trocasRes, clientesRes, produtosRes, funcionariosRes, motivosRes] = await Promise.all([
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/Visita?limit=10000`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            }),
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/EstoqueVisita?limit=10000`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            }),
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/TrocaVisita?limit=10000`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            }),
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/Cliente?limit=10000`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            }),
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/Produto?limit=10000`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            }),
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/Funcionario?limit=10000`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            }),
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/MotivoTroca?limit=10000`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            })
        ]);

        const [visitas, estoques, trocas, clientes, produtos, funcionarios, motivos] = await Promise.all([
            visitasRes.json(),
            estoquesRes.json(),
            trocasRes.json(),
            clientesRes.json(),
            produtosRes.json(),
            funcionariosRes.json(),
            motivosRes.json()
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

        // Importar em lotes (batch) para melhor performance
        const BATCH_SIZE = 50;
        
        // Importar Visitas em lotes
        const visitasParaImportar = [];
        for (const visita of visitas) {
            const cliente = clientesMap[visita.cliente_id];
            const promotor = funcionariosMap[visita.promotor_id];

            visitasParaImportar.push({
                origem_app_id: GESTOR_VISITA_APP_ID,
                origem_visita_id: visita.id,
                cliente_nome: cliente?.nome_fantasia || 'N/A',
                cliente_codigo: cliente?.codigo_interno,
                cliente_cidade: cliente?.cidade,
                cliente_uf: cliente?.uf,
                cliente_segmento: cliente?.segmento,
                promotor_nome: promotor?.nome_completo,
                promotor_funcao: promotor?.funcao,
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

        // Criar visitas em lotes
        for (let i = 0; i < visitasParaImportar.length; i += BATCH_SIZE) {
            const batch = visitasParaImportar.slice(i, i + BATCH_SIZE);
            try {
                await base44.asServiceRole.entities.RelatorioVisita.bulkCreate(batch);
                resultado.visitas_importadas += batch.length;
            } catch (error) {
                resultado.erros.push({ tipo: 'visita_batch', erro: error.message });
            }
        }

        // Importar Estoques em lotes
        const estoquesParaImportar = [];
        for (const estoque of estoques) {
            const produto = produtosMap[estoque.produto_id];
            const visita = visitas.find(v => v.id === estoque.visita_id);
            const cliente = clientesMap[visita?.cliente_id];
            const promotor = funcionariosMap[visita?.promotor_id];

            estoquesParaImportar.push({
                origem_app_id: GESTOR_VISITA_APP_ID,
                origem_estoque_id: estoque.id,
                origem_visita_id: estoque.visita_id,
                cliente_nome: cliente?.nome_fantasia,
                cliente_codigo: cliente?.codigo_interno,
                produto_codigo: produto?.codigo,
                produto_descricao: produto?.descricao,
                produto_gramatura: produto?.gramatura,
                quantidade: estoque.quantidade,
                data_validade: estoque.data_validade,
                data_fabricacao: estoque.data_fabricacao,
                horario_fabricacao: estoque.horario_fabricacao,
                data_registro: estoque.created_date,
                promotor_nome: promotor?.nome_completo
            });
        }

        for (let i = 0; i < estoquesParaImportar.length; i += BATCH_SIZE) {
            const batch = estoquesParaImportar.slice(i, i + BATCH_SIZE);
            try {
                await base44.asServiceRole.entities.RelatorioEstoque.bulkCreate(batch);
                resultado.estoques_importados += batch.length;
            } catch (error) {
                resultado.erros.push({ tipo: 'estoque_batch', erro: error.message });
            }
        }

        // Importar Trocas em lotes
        const trocasParaImportar = [];
        
        // Criar um Map de visitas para lookup mais rápido
        const visitasMap = Object.fromEntries(visitas.map(v => [v.id, v]));
        
        for (const troca of trocas) {
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
                    cliente_nome: cliente?.nome_fantasia || 'N/A',
                    cliente_codigo: cliente?.codigo_interno || '',
                    produto_codigo: produto?.codigo || '',
                    produto_descricao: produto?.descricao || troca.produto_descricao || 'N/A',
                    motivo_troca: motivo?.motivo || 'N/A',
                    quantidade: troca.quantidade || 0,
                    data_validade: troca.data_validade || null,
                    data_fabricacao: troca.data_fabricacao || null,
                    horario_fabricacao: troca.horario_fabricacao || null,
                    ja_informado_anteriormente: troca.ja_informado_anteriormente || false,
                    foto_url: troca.foto_url || null,
                    data_registro: troca.created_date || new Date().toISOString(),
                    promotor_nome: promotor?.nome_completo || 'N/A',
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
            } catch (error) {
                resultado.erros.push({ 
                    tipo: 'troca_batch', 
                    lote: i, 
                    erro: error.message,
                    stack: error.stack 
                });
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
                total_visitas_importadas: (config.total_visitas_importadas || 0) + resultado.visitas_importadas,
                total_estoques_importados: (config.total_estoques_importados || 0) + resultado.estoques_importados,
                total_trocas_importadas: (config.total_trocas_importadas || 0) + resultado.trocas_importadas
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