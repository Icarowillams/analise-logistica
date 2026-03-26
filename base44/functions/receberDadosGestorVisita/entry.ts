import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();

        // === Ação: atualizar_status_pedido_troca (chamada pelo app logístico) ===
        if (payload.acao === 'atualizar_status_pedido_troca') {
            const { pedido_id, novo_status } = payload;
            if (!pedido_id || !novo_status) {
                return Response.json({ error: 'pedido_id e novo_status são obrigatórios' }, { status: 400 });
            }
            const statusValidos = ['liberado', 'montagem', 'faturado'];
            if (!statusValidos.includes(novo_status)) {
                return Response.json({ error: `Status inválido: ${novo_status}. Valores aceitos: ${statusValidos.join(', ')}` }, { status: 400 });
            }
            const updateData = { status: novo_status };
            if (payload.numero_carga) updateData.numero_carga = payload.numero_carga;
            await base44.asServiceRole.entities.Pedido.update(pedido_id, updateData);
            return Response.json({ success: true, pedido_id, novo_status });
        }

        // === Fluxo original: importar dados do Gestor Visita ===
        const { app_origem_id, visitas = [], estoques = [], trocas = [] } = payload;

        if (!app_origem_id) {
            return Response.json({ error: 'app_origem_id é obrigatório' }, { status: 400 });
        }

        const resultado = {
            success: true,
            visitas_importadas: 0,
            estoques_importados: 0,
            trocas_importadas: 0,
            duplicatas_ignoradas: 0,
            erros: []
        };

        // Buscar registros existentes para evitar duplicatas
        const [visitasExistentes, estoquesExistentes, trocasExistentes] = await Promise.all([
            base44.asServiceRole.entities.RelatorioVisita.filter({ origem_app_id }),
            base44.asServiceRole.entities.RelatorioEstoque.filter({ origem_app_id }),
            base44.asServiceRole.entities.RelatorioTroca.filter({ origem_app_id })
        ]);

        const visitasJaImportadas = new Set(visitasExistentes.map(v => v.origem_visita_id));
        const estoquesJaImportados = new Set(estoquesExistentes.map(e => e.origem_estoque_id));
        const trocasJaImportadas = new Set(trocasExistentes.map(t => t.origem_troca_id));

        // Filtrar apenas registros novos
        const visitasNovas = visitas.filter(v => {
            const id = v.origem_visita_id || v.id;
            if (visitasJaImportadas.has(id)) {
                resultado.duplicatas_ignoradas++;
                return false;
            }
            return true;
        });

        const estoquesNovos = estoques.filter(e => {
            const id = e.origem_estoque_id || e.id;
            if (estoquesJaImportados.has(id)) {
                resultado.duplicatas_ignoradas++;
                return false;
            }
            return true;
        });

        const trocasNovas = trocas.filter(t => {
            const id = t.origem_troca_id || t.id;
            if (trocasJaImportadas.has(id)) {
                resultado.duplicatas_ignoradas++;
                return false;
            }
            return true;
        });

        // Importar Visitas em lote
        if (visitasNovas.length > 0) {
            try {
                const visitasFormatadas = visitasNovas.map(v => ({
                    origem_app_id,
                    origem_visita_id: v.origem_visita_id || v.id,
                    cliente_nome: v.cliente_nome,
                    cliente_codigo: v.cliente_codigo,
                    cliente_cidade: v.cliente_cidade,
                    cliente_uf: v.cliente_uf,
                    cliente_segmento: v.cliente_segmento,
                    promotor_nome: v.promotor_nome,
                    promotor_funcao: v.promotor_funcao,
                    data_visita: v.data_visita,
                    checkin_time: v.checkin_time,
                    checkout_time: v.checkout_time,
                    status: v.status || 'pendente',
                    justificativa_nao_atendimento: v.justificativa_nao_atendimento,
                    pedido_solicitado: v.pedido_solicitado || false,
                    motivo_nao_solicitacao: v.motivo_nao_solicitacao,
                    dia_semana: v.dia_semana
                }));
                await base44.asServiceRole.entities.RelatorioVisita.bulkCreate(visitasFormatadas);
                resultado.visitas_importadas = visitasFormatadas.length;
            } catch (error) {
                resultado.erros.push({ tipo: 'visitas_bulk', erro: error.message });
            }
        }

        // Importar Estoques em lote
        if (estoquesNovos.length > 0) {
            try {
                const estoquesFormatados = estoquesNovos.map(e => ({
                    origem_app_id,
                    origem_estoque_id: e.origem_estoque_id || e.id,
                    origem_visita_id: e.origem_visita_id,
                    cliente_nome: e.cliente_nome,
                    cliente_codigo: e.cliente_codigo,
                    produto_codigo: e.produto_codigo,
                    produto_descricao: e.produto_descricao,
                    produto_gramatura: e.produto_gramatura,
                    quantidade: e.quantidade,
                    data_validade: e.data_validade,
                    data_fabricacao: e.data_fabricacao,
                    horario_fabricacao: e.horario_fabricacao,
                    data_registro: e.data_registro || new Date().toISOString(),
                    promotor_nome: e.promotor_nome
                }));
                await base44.asServiceRole.entities.RelatorioEstoque.bulkCreate(estoquesFormatados);
                resultado.estoques_importados = estoquesFormatados.length;
            } catch (error) {
                resultado.erros.push({ tipo: 'estoques_bulk', erro: error.message });
            }
        }

        // Importar Trocas em lote
        if (trocasNovas.length > 0) {
            try {
                const trocasFormatadas = trocasNovas.map(t => {
                    let diasVidaUtil = null;
                    if (t.data_validade && t.data_fabricacao) {
                        const dataVal = new Date(t.data_validade);
                        const dataFab = new Date(t.data_fabricacao);
                        const diffDias = Math.floor((dataVal - dataFab) / (1000 * 60 * 60 * 24));
                        diasVidaUtil = 25 - diffDias;
                    }

                    return {
                        origem_app_id,
                        origem_troca_id: t.origem_troca_id || t.id,
                        origem_visita_id: t.origem_visita_id,
                        cliente_nome: t.cliente_nome,
                        cliente_codigo: t.cliente_codigo,
                        produto_codigo: t.produto_codigo,
                        produto_descricao: t.produto_descricao,
                        motivo_troca: t.motivo_troca,
                        quantidade: t.quantidade,
                        data_validade: t.data_validade,
                        data_fabricacao: t.data_fabricacao,
                        horario_fabricacao: t.horario_fabricacao,
                        ja_informado_anteriormente: t.ja_informado_anteriormente || false,
                        foto_url: t.foto_url,
                        data_registro: t.data_registro || new Date().toISOString(),
                        promotor_nome: t.promotor_nome,
                        dias_vida_util: diasVidaUtil
                    };
                });
                await base44.asServiceRole.entities.RelatorioTroca.bulkCreate(trocasFormatadas);
                resultado.trocas_importadas = trocasFormatadas.length;
            } catch (error) {
                resultado.erros.push({ tipo: 'trocas_bulk', erro: error.message });
            }
        }

        // Atualizar configuração com totais reais
        const [novoTotalVisitas, novoTotalEstoques, novoTotalTrocas] = await Promise.all([
            base44.asServiceRole.entities.RelatorioVisita.filter({ origem_app_id }),
            base44.asServiceRole.entities.RelatorioEstoque.filter({ origem_app_id }),
            base44.asServiceRole.entities.RelatorioTroca.filter({ origem_app_id })
        ]);

        const configsExistentes = await base44.asServiceRole.entities.ConfiguracaoImportacao.filter({ app_origem_id });

        if (configsExistentes.length > 0) {
            await base44.asServiceRole.entities.ConfiguracaoImportacao.update(configsExistentes[0].id, {
                ultima_importacao: new Date().toISOString(),
                total_visitas_importadas: novoTotalVisitas.length,
                total_estoques_importados: novoTotalEstoques.length,
                total_trocas_importadas: novoTotalTrocas.length
            });
        } else {
            await base44.asServiceRole.entities.ConfiguracaoImportacao.create({
                app_origem_id,
                app_origem_nome: payload.app_origem_nome || 'Gestor Visita',
                ultima_importacao: new Date().toISOString(),
                total_visitas_importadas: novoTotalVisitas.length,
                total_estoques_importados: novoTotalEstoques.length,
                total_trocas_importadas: novoTotalTrocas.length,
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