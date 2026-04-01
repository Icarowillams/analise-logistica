import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Webhook receptor — recebe mudanças de status do app Logístico Control
// Autenticação via api_key (chamada máquina-a-máquina, sem user auth)
// Busca SEMPRE por numero_pedido na entidade Pedido (vendas + trocas + bonificações)

const TRANSICOES_PERMITIDAS = {
    enviado:   ['montagem', 'faturado', 'liberado', 'cancelado'],
    liberado:  ['montagem', 'faturado', 'enviado', 'cancelado'],
    montagem:  ['faturado', 'liberado', 'cancelado'],
    faturado:  ['cancelado'],
};

// Mapeamento de status do Logístico para status interno
// O Logístico pode enviar nomes diferentes, aqui normalizamos
const MAPEAMENTO_STATUS = {
    'cancelado': 'cancelado',
    'nao_entregue': 'cancelado',
    'não entregue': 'cancelado',
    'nao entregue': 'cancelado',
    'montagem': 'montagem',
    'em montagem': 'montagem',
    'faturado': 'faturado',
    'liberado': 'liberado',
    'enviado': 'enviado',
};

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { api_key, atualizacoes } = body;

        console.log(`[receberStatus] Recebido. Total: ${atualizacoes?.length || 0}`);

        // Validar api_key
        const expectedKey = Deno.env.get('BASE_REMOTE_API_KEY');
        if (!expectedKey || api_key !== expectedKey) {
            console.error(`[receberStatus] API KEY INVÁLIDA`);
            return Response.json({ error: 'Unauthorized: invalid api_key' }, { status: 401 });
        }

        if (!atualizacoes || !Array.isArray(atualizacoes) || atualizacoes.length === 0) {
            return Response.json({ error: 'atualizacoes é obrigatório (array não vazio)' }, { status: 400 });
        }

        // SDK com service role (webhook não tem user auth)
        const base44 = createClientFromRequest(req);

        let atualizados = 0;
        let erros = 0;
        let ignorados = 0;
        const detalhes = [];

        for (const item of atualizacoes) {
            const { numero_pedido, numero_carga, observacao, tipo, produto } = item;

            if (!numero_pedido) {
                erros++;
                detalhes.push({ numero_pedido, sucesso: false, erro: 'numero_pedido é obrigatório' });
                continue;
            }

            try {
                // Buscar pelo numero_pedido - normaliza removendo zeros à esquerda
                const numeroPedidoLimpo = String(numero_pedido).replace(/^0+/, '') || '0';
                const todosPedidos = await base44.asServiceRole.entities.Pedido.list();
                const encontrados = todosPedidos.filter(p => {
                    const numPedido = String(p.numero_pedido || '').replace(/^0+/, '') || '0';
                    return numPedido === numeroPedidoLimpo;
                });
                
                if (encontrados.length === 0) {
                    erros++;
                    detalhes.push({ numero_pedido: String(numero_pedido), sucesso: false, erro: `Pedido "${numero_pedido}" não encontrado` });
                    continue;
                }

                const pedido = encontrados.length > 1
                    ? encontrados.filter(p => p.status !== 'cancelado').sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0] || encontrados[0]
                    : encontrados[0];

                console.log(`[receberStatus] Pedido ${numero_pedido}: id=${pedido.id}, tipo_acao="${tipo || 'status'}"`);

                // === EDITAR PRODUTO ===
                if (tipo === 'editar_produto') {
                    if (!produto || !produto.codigo_produto) {
                        erros++;
                        detalhes.push({ numero_pedido: String(numero_pedido), sucesso: false, erro: 'produto.codigo_produto é obrigatório para editar_produto' });
                        continue;
                    }

                    // Buscar itens do pedido
                    const itensPedido = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: pedido.id });
                    const itemEncontrado = itensPedido.find(it => String(it.produto_codigo || '').trim() === String(produto.codigo_produto).trim());

                    if (!itemEncontrado) {
                        erros++;
                        detalhes.push({ numero_pedido: String(numero_pedido), sucesso: false, erro: `Produto "${produto.codigo_produto}" não encontrado no pedido` });
                        continue;
                    }

                    if (produto.removido === true) {
                        // Remover item
                        await base44.asServiceRole.entities.PedidoItem.delete(itemEncontrado.id);
                        console.log(`[receberStatus] ${numero_pedido}: Produto ${produto.codigo_produto} REMOVIDO`);
                    } else {
                        // Atualizar quantidade e valor
                        const updateItem = {};
                        if (produto.quantidade_nova !== undefined) updateItem.quantidade = produto.quantidade_nova;
                        if (produto.valor_unitario !== undefined) updateItem.valor_unitario = produto.valor_unitario;
                        if (produto.valor_total !== undefined) {
                            updateItem.valor_total = produto.valor_total;
                        } else if (produto.quantidade_nova !== undefined) {
                            updateItem.valor_total = produto.quantidade_nova * (produto.valor_unitario ?? itemEncontrado.valor_unitario ?? 0);
                        }
                        await base44.asServiceRole.entities.PedidoItem.update(itemEncontrado.id, updateItem);
                        console.log(`[receberStatus] ${numero_pedido}: Produto ${produto.codigo_produto} atualizado qtd=${produto.quantidade_nova}`);
                    }

                    // Recalcular total do pedido
                    const itensAtualizados = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: pedido.id });
                    const novoTotal = itensAtualizados.reduce((s, it) => s + (it.valor_total || 0), 0);
                    const totalItens = itensAtualizados.reduce((s, it) => s + (it.quantidade || 0), 0);
                    await base44.asServiceRole.entities.Pedido.update(pedido.id, {
                        valor_total: novoTotal,
                        total_itens: totalItens,
                    });

                    atualizados++;
                    detalhes.push({
                        numero_pedido: String(numero_pedido),
                        sucesso: true,
                        tipo: 'editar_produto',
                        produto_codigo: produto.codigo_produto,
                        removido: produto.removido || false,
                        novo_total_pedido: novoTotal,
                        observacao: observacao || '',
                    });
                    continue;
                }

                // === MUDANÇA DE STATUS (comportamento original) ===
                const statusRecebido = String(item.novo_status || '').toLowerCase().trim();
                const novo_status = MAPEAMENTO_STATUS[statusRecebido] || statusRecebido;

                console.log(`[receberStatus] ${numero_pedido}: status_recebido="${statusRecebido}", novo_status="${novo_status}"`);

                if (!novo_status) {
                    erros++;
                    detalhes.push({ numero_pedido: String(numero_pedido), sucesso: false, erro: 'novo_status é obrigatório para mudança de status' });
                    continue;
                }

                const transicoesValidas = TRANSICOES_PERMITIDAS[pedido.status];
                if (!transicoesValidas || !transicoesValidas.includes(novo_status)) {
                    ignorados++;
                    detalhes.push({ numero_pedido: String(numero_pedido), sucesso: false, ignorado: true, erro: `Transição ${pedido.status} → ${novo_status} não permitida` });
                    continue;
                }

                const updateData = { status: novo_status };

                if (numero_carga !== undefined) {
                    updateData.numero_carga = numero_carga ? String(numero_carga) : null;
                }

                if (novo_status === 'cancelado') {
                    updateData.motivo_cancelamento = observacao || 'Cancelado via Logístico Control';
                    updateData.data_cancelamento = new Date().toISOString();
                    updateData.cancelado_por = 'logistico';
                    updateData.cancelado_por_nome = 'Logístico Control';
                }

                if (novo_status === 'liberado') {
                    updateData.numero_carga = null;
                }

                await base44.asServiceRole.entities.Pedido.update(pedido.id, updateData);
                atualizados++;
                detalhes.push({ numero_pedido: String(numero_pedido), sucesso: true, de: pedido.status, para: novo_status });

                console.log(`[receberStatus] ${numero_pedido}: ${pedido.status} → ${novo_status}`);

            } catch (e) {
                erros++;
                detalhes.push({ numero_pedido: String(numero_pedido), sucesso: false, erro: e.message });
                console.error(`[receberStatus] Erro ${numero_pedido}:`, e.message);
            }
        }

        console.log(`[receberStatus] Resultado: ${atualizados} atualizados, ${erros} erros, ${ignorados} ignorados`);

        return Response.json({
            sucesso: true,
            total_recebidos: atualizacoes.length,
            total_atualizados: atualizados,
            total_erros: erros,
            total_ignorados: ignorados,
            detalhes
        });

    } catch (error) {
        console.error('[receberStatus] Erro geral:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});