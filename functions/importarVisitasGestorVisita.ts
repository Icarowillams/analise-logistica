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
            erros: []
        };

        // Buscar Visitas
        const visitasResponse = await fetch(
            `https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/Visita`,
            {
                headers: {
                    'api_key': GESTOR_VISITA_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );
        const visitas = await visitasResponse.json();

        // Buscar Clientes, Produtos, Funcionários para enriquecer dados
        const [clientesRes, produtosRes, funcionariosRes, motivosRes] = await Promise.all([
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/Cliente`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            }),
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/Produto`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            }),
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/Funcionario`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            }),
            fetch(`https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/MotivoTroca`, {
                headers: { 'api_key': GESTOR_VISITA_API_KEY }
            })
        ]);

        const clientes = await clientesRes.json();
        const produtos = await produtosRes.json();
        const funcionarios = await funcionariosRes.json();
        const motivos = await motivosRes.json();

        // Mapear para fácil acesso
        const clientesMap = Object.fromEntries(clientes.map(c => [c.id, c]));
        const produtosMap = Object.fromEntries(produtos.map(p => [p.id, p]));
        const funcionariosMap = Object.fromEntries(funcionarios.map(f => [f.id, f]));
        const motivosMap = Object.fromEntries(motivos.map(m => [m.id, m]));

        // Importar Visitas
        for (const visita of visitas) {
            try {
                const cliente = clientesMap[visita.cliente_id];
                const promotor = funcionariosMap[visita.promotor_id];

                // Verificar se já existe
                const existentes = await base44.asServiceRole.entities.RelatorioVisita.filter({
                    origem_visita_id: visita.id
                });

                if (existentes.length === 0) {
                    await base44.asServiceRole.entities.RelatorioVisita.create({
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
                    resultado.visitas_importadas++;
                }
            } catch (error) {
                resultado.erros.push({
                    tipo: 'visita',
                    id: visita.id,
                    erro: error.message
                });
            }
        }

        // Buscar e importar Estoques
        const estoquesResponse = await fetch(
            `https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/EstoqueVisita`,
            {
                headers: {
                    'api_key': GESTOR_VISITA_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );
        const estoques = await estoquesResponse.json();

        for (const estoque of estoques) {
            try {
                const produto = produtosMap[estoque.produto_id];
                const visita = visitas.find(v => v.id === estoque.visita_id);
                const cliente = clientesMap[visita?.cliente_id];
                const promotor = funcionariosMap[visita?.promotor_id];

                const existentes = await base44.asServiceRole.entities.RelatorioEstoque.filter({
                    origem_estoque_id: estoque.id
                });

                if (existentes.length === 0) {
                    await base44.asServiceRole.entities.RelatorioEstoque.create({
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
                    resultado.estoques_importados++;
                }
            } catch (error) {
                resultado.erros.push({
                    tipo: 'estoque',
                    id: estoque.id,
                    erro: error.message
                });
            }
        }

        // Buscar e importar Trocas
        const trocasResponse = await fetch(
            `https://app.base44.com/api/apps/${GESTOR_VISITA_APP_ID}/entities/TrocaVisita`,
            {
                headers: {
                    'api_key': GESTOR_VISITA_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );
        const trocas = await trocasResponse.json();

        for (const troca of trocas) {
            try {
                const produto = produtosMap[troca.produto_id];
                const motivo = motivosMap[troca.motivo_troca_id];
                const visita = visitas.find(v => v.id === troca.visita_id);
                const cliente = clientesMap[visita?.cliente_id];
                const promotor = funcionariosMap[visita?.promotor_id];

                const existentes = await base44.asServiceRole.entities.RelatorioTroca.filter({
                    origem_troca_id: troca.id
                });

                if (existentes.length === 0) {
                    // Calcular dias de vida útil
                    let diasVidaUtil = null;
                    if (troca.data_validade && troca.data_fabricacao) {
                        const dataVal = new Date(troca.data_validade);
                        const dataFab = new Date(troca.data_fabricacao);
                        const diffDias = Math.floor((dataVal - dataFab) / (1000 * 60 * 60 * 24));
                        diasVidaUtil = 25 - diffDias;
                    }

                    await base44.asServiceRole.entities.RelatorioTroca.create({
                        origem_app_id: GESTOR_VISITA_APP_ID,
                        origem_troca_id: troca.id,
                        origem_visita_id: troca.visita_id,
                        cliente_nome: cliente?.nome_fantasia,
                        cliente_codigo: cliente?.codigo_interno,
                        produto_codigo: produto?.codigo,
                        produto_descricao: produto?.descricao,
                        motivo_troca: motivo?.motivo,
                        quantidade: troca.quantidade,
                        data_validade: troca.data_validade,
                        data_fabricacao: troca.data_fabricacao,
                        horario_fabricacao: troca.horario_fabricacao,
                        ja_informado_anteriormente: troca.ja_informado_anteriormente || false,
                        foto_url: troca.foto_url,
                        data_registro: troca.created_date,
                        promotor_nome: promotor?.nome_completo,
                        dias_vida_util: diasVidaUtil
                    });
                    resultado.trocas_importadas++;
                }
            } catch (error) {
                resultado.erros.push({
                    tipo: 'troca',
                    id: troca.id,
                    erro: error.message
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