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
            const { numero_pedido, novo_status, numero_carga, observacao } = item;

            if (!numero_pedido || !novo_status) {
                erros++;
                detalhes.push({ numero_pedido, sucesso: false, erro: 'numero_pedido e novo_status são obrigatórios' });
                continue;
            }

            try {
                // Buscar pelo numero_pedido (vendas, trocas e bonificações na mesma entidade)
                const encontrados = await base44.asServiceRole.entities.Pedido.filter({ numero_pedido: String(numero_pedido) });
                
                if (encontrados.length === 0) {
                    erros++;
                    detalhes.push({ numero_pedido: String(numero_pedido), sucesso: false, erro: `Pedido "${numero_pedido}" não encontrado` });
                    continue;
                }

                // Se houver múltiplos pedidos com mesmo numero, pegar o ativo (não cancelado), mais recente
                const pedido = encontrados.length > 1
                    ? encontrados.filter(p => p.status !== 'cancelado').sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0] || encontrados[0]
                    : encontrados[0];
                
                console.log(`[receberStatus] Pedido ${numero_pedido}: encontrados ${encontrados.length}, usando id=${pedido.id} status=${pedido.status}`);

                // Verificar transição permitida
                const transicoesValidas = TRANSICOES_PERMITIDAS[pedido.status];
                if (!transicoesValidas || !transicoesValidas.includes(novo_status)) {
                    ignorados++;
                    detalhes.push({ numero_pedido: String(numero_pedido), sucesso: false, ignorado: true, erro: `Transição ${pedido.status} → ${novo_status} não permitida` });
                    continue;
                }

                const updateData = { status: novo_status };

                // numero_carga (opcional)
                if (numero_carga !== undefined) {
                    updateData.numero_carga = numero_carga ? String(numero_carga) : null;
                }

                // Cancelamento: salvar dados extras
                if (novo_status === 'cancelado') {
                    updateData.motivo_cancelamento = observacao || 'Cancelado via Logístico Control';
                    updateData.data_cancelamento = new Date().toISOString();
                    updateData.cancelado_por = 'logistico';
                    updateData.cancelado_por_nome = 'Logístico Control';
                }

                // Carga desfeita: limpar numero_carga
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