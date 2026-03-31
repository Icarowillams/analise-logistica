import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Webhook receptor — recebe mudanças de status do app Logístico Control
// Aceita tanto vendas quanto trocas
// Autenticação via api_key (sem user auth, pois é chamada máquina-a-máquina)

const TRANSICOES_PERMITIDAS = {
    enviado:  ['montagem', 'faturado', 'liberado', 'cancelado'],
    liberado: ['montagem', 'faturado', 'enviado', 'cancelado'],
    montagem: ['faturado', 'liberado', 'cancelado'],
    faturado: ['cancelado'],
};

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { api_key, atualizacoes } = body;

        console.log(`[receberStatusLogistico] Chamada recebida. Tem api_key: ${!!api_key}, Tem atualizacoes: ${!!atualizacoes}, Total: ${atualizacoes?.length || 0}`);
        if (atualizacoes && atualizacoes.length > 0) {
            console.log(`[receberStatusLogistico] Primeira atualização:`, JSON.stringify(atualizacoes[0]));
        }

        // Validar api_key
        const expectedKey = Deno.env.get('BASE_REMOTE_API_KEY');
        if (!expectedKey || api_key !== expectedKey) {
            console.error(`[receberStatusLogistico] API KEY INVÁLIDA. Recebida: "${api_key?.substring(0, 8)}...", Esperada começa com: "${expectedKey?.substring(0, 8)}..."`);
            return Response.json({ error: 'Unauthorized: invalid api_key' }, { status: 401 });
        }

        if (!atualizacoes || !Array.isArray(atualizacoes) || atualizacoes.length === 0) {
            return Response.json({ error: 'atualizacoes é obrigatório (array não vazio)' }, { status: 400 });
        }

        // Inicializar SDK com service role (sem user auth pois é webhook)
        const base44 = createClientFromRequest(req);

        let atualizados = 0;
        let erros = 0;
        let ignorados = 0;
        const detalhes = [];

        for (const item of atualizacoes) {
            const { pedido_id, numero_pedido, novo_status, numero_carga, observacao } = item;

            if ((!pedido_id && !numero_pedido) || !novo_status) {
                erros++;
                detalhes.push({ pedido_id, numero_pedido, sucesso: false, erro: 'pedido_id ou numero_pedido + novo_status são obrigatórios' });
                continue;
            }

            try {
                let pedido;
                let resolvedPedidoId = pedido_id;

                if (pedido_id) {
                    pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
                } else {
                    // Buscar pelo numero_pedido
                    const encontrados = await base44.asServiceRole.entities.Pedido.filter({ numero_pedido: String(numero_pedido) });
                    if (encontrados.length === 0) {
                        erros++;
                        detalhes.push({ numero_pedido, sucesso: false, erro: `Pedido com numero_pedido "${numero_pedido}" não encontrado` });
                        continue;
                    }
                    pedido = encontrados[0];
                    resolvedPedidoId = pedido.id;
                }
                if (!pedido) {
                    erros++;
                    detalhes.push({ pedido_id: resolvedPedidoId, numero_pedido: pedido?.numero_pedido, sucesso: false, erro: 'Pedido não encontrado' });
                    continue;
                }

                // Verificar se a transição é permitida
                const transicoesValidas = TRANSICOES_PERMITIDAS[pedido.status];
                if (!transicoesValidas || !transicoesValidas.includes(novo_status)) {
                    ignorados++;
                    detalhes.push({ pedido_id: resolvedPedidoId, numero_pedido: pedido.numero_pedido, sucesso: false, ignorado: true, erro: `Transição ${pedido.status} → ${novo_status} não permitida` });
                    continue;
                }

                const updateData = { status: novo_status };

                if (numero_carga !== undefined) {
                    updateData.numero_carga = numero_carga ? String(numero_carga) : null;
                }

                // Dados extras para cancelamento
                if (novo_status === 'cancelado') {
                    updateData.motivo_cancelamento = observacao || 'Cancelado via Logístico Control';
                    updateData.data_cancelamento = new Date().toISOString();
                    updateData.cancelado_por = 'logistico';
                    updateData.cancelado_por_nome = 'Logístico Control';
                }

                // Carga desfeita: limpar numero_carga ao voltar para liberado
                if (novo_status === 'liberado' && pedido.status === 'montagem') {
                    updateData.numero_carga = null;
                }

                await base44.asServiceRole.entities.Pedido.update(resolvedPedidoId, updateData);
                atualizados++;
                detalhes.push({ pedido_id: resolvedPedidoId, numero_pedido: pedido.numero_pedido, sucesso: true, de: pedido.status, para: novo_status });

                console.log(`[receberStatusLogistico] Pedido ${pedido.numero_pedido || resolvedPedidoId}: ${pedido.status} → ${novo_status}`);

            } catch (e) {
                erros++;
                detalhes.push({ pedido_id: resolvedPedidoId, numero_pedido, sucesso: false, erro: e.message });
                console.error(`[receberStatusLogistico] Erro pedido ${resolvedPedidoId || numero_pedido}:`, e.message);
            }
        }

        console.log(`[receberStatusLogistico] Processados: ${atualizacoes.length}, Atualizados: ${atualizados}, Erros: ${erros}, Ignorados: ${ignorados}`);

        return Response.json({
            sucesso: true,
            total_recebidos: atualizacoes.length,
            total_atualizados: atualizados,
            total_erros: erros,
            total_ignorados: ignorados,
            detalhes
        });

    } catch (error) {
        console.error('[receberStatusLogistico] Erro geral:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});