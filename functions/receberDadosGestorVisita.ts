import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Webhook não precisa de autenticação de usuário
        // mas vamos validar a origem dos dados
        
        const payload = await req.json();
        const { app_origem_id, visitas = [], estoques = [], trocas = [] } = payload;

        if (!app_origem_id) {
            return Response.json({ 
                error: 'app_origem_id é obrigatório' 
            }, { status: 400 });
        }

        const resultado = {
            success: true,
            visitas_importadas: 0,
            estoques_importados: 0,
            trocas_importadas: 0,
            erros: []
        };

        // Importar Visitas
        for (const visita of visitas) {
            try {
                await base44.asServiceRole.entities.RelatorioVisita.create({
                    origem_app_id: app_origem_id,
                    origem_visita_id: visita.origem_visita_id || visita.id,
                    cliente_nome: visita.cliente_nome,
                    cliente_codigo: visita.cliente_codigo,
                    cliente_cidade: visita.cliente_cidade,
                    cliente_uf: visita.cliente_uf,
                    cliente_segmento: visita.cliente_segmento,
                    promotor_nome: visita.promotor_nome,
                    promotor_funcao: visita.promotor_funcao,
                    data_visita: visita.data_visita,
                    checkin_time: visita.checkin_time,
                    checkout_time: visita.checkout_time,
                    status: visita.status || 'pendente',
                    justificativa_nao_atendimento: visita.justificativa_nao_atendimento,
                    pedido_solicitado: visita.pedido_solicitado || false,
                    motivo_nao_solicitacao: visita.motivo_nao_solicitacao,
                    dia_semana: visita.dia_semana
                });
                resultado.visitas_importadas++;
            } catch (error) {
                resultado.erros.push({
                    tipo: 'visita',
                    id: visita.id || visita.origem_visita_id,
                    erro: error.message
                });
            }
        }

        // Importar Estoques
        for (const estoque of estoques) {
            try {
                await base44.asServiceRole.entities.RelatorioEstoque.create({
                    origem_app_id: app_origem_id,
                    origem_estoque_id: estoque.origem_estoque_id || estoque.id,
                    origem_visita_id: estoque.origem_visita_id,
                    cliente_nome: estoque.cliente_nome,
                    cliente_codigo: estoque.cliente_codigo,
                    produto_codigo: estoque.produto_codigo,
                    produto_descricao: estoque.produto_descricao,
                    produto_gramatura: estoque.produto_gramatura,
                    quantidade: estoque.quantidade,
                    data_validade: estoque.data_validade,
                    data_fabricacao: estoque.data_fabricacao,
                    horario_fabricacao: estoque.horario_fabricacao,
                    data_registro: estoque.data_registro || new Date().toISOString(),
                    promotor_nome: estoque.promotor_nome
                });
                resultado.estoques_importados++;
            } catch (error) {
                resultado.erros.push({
                    tipo: 'estoque',
                    id: estoque.id || estoque.origem_estoque_id,
                    erro: error.message
                });
            }
        }

        // Importar Trocas
        for (const troca of trocas) {
            try {
                // Calcular dias de vida útil
                let diasVidaUtil = null;
                if (troca.data_validade && troca.data_fabricacao) {
                    const dataVal = new Date(troca.data_validade);
                    const dataFab = new Date(troca.data_fabricacao);
                    const diffDias = Math.floor((dataVal - dataFab) / (1000 * 60 * 60 * 24));
                    diasVidaUtil = 25 - diffDias;
                }

                await base44.asServiceRole.entities.RelatorioTroca.create({
                    origem_app_id: app_origem_id,
                    origem_troca_id: troca.origem_troca_id || troca.id,
                    origem_visita_id: troca.origem_visita_id,
                    cliente_nome: troca.cliente_nome,
                    cliente_codigo: troca.cliente_codigo,
                    produto_codigo: troca.produto_codigo,
                    produto_descricao: troca.produto_descricao,
                    motivo_troca: troca.motivo_troca,
                    quantidade: troca.quantidade,
                    data_validade: troca.data_validade,
                    data_fabricacao: troca.data_fabricacao,
                    horario_fabricacao: troca.horario_fabricacao,
                    ja_informado_anteriormente: troca.ja_informado_anteriormente || false,
                    foto_url: troca.foto_url,
                    data_registro: troca.data_registro || new Date().toISOString(),
                    promotor_nome: troca.promotor_nome,
                    dias_vida_util: diasVidaUtil
                });
                resultado.trocas_importadas++;
            } catch (error) {
                resultado.erros.push({
                    tipo: 'troca',
                    id: troca.id || troca.origem_troca_id,
                    erro: error.message
                });
            }
        }

        // Atualizar ou criar ConfiguracaoImportacao
        const configsExistentes = await base44.asServiceRole.entities.ConfiguracaoImportacao.filter({
            app_origem_id
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
                app_origem_id,
                app_origem_nome: payload.app_origem_nome || 'Gestor Visita',
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
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});