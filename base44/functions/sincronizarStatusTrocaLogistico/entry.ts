import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const LOGISTICO_URL = Deno.env.get('LOGISTICO_FUNCTION_URL');
        if (!LOGISTICO_URL) {
            return Response.json({ error: 'LOGISTICO_FUNCTION_URL não configurada' }, { status: 500 });
        }

        const apiKey = Deno.env.get('BASE_REMOTE_API_KEY');
        if (!apiKey) {
            return Response.json({ error: 'BASE_REMOTE_API_KEY não configurada' }, { status: 500 });
        }

        // Buscar automaticamente pedidos de troca ativos
        const [trocasLiberadas, trocasMontagem, trocasEnviadas] = await Promise.all([
            base44.asServiceRole.entities.Pedido.filter({ tipo: 'troca', status: 'liberado' }),
            base44.asServiceRole.entities.Pedido.filter({ tipo: 'troca', status: 'montagem' }),
            base44.asServiceRole.entities.Pedido.filter({ tipo: 'troca', status: 'enviado' }),
        ]);
        const trocasAtivas = [...trocasLiberadas, ...trocasMontagem, ...trocasEnviadas];

        if (trocasAtivas.length === 0) {
            return Response.json({ success: true, message: 'Nenhuma troca ativa para sincronizar', total_atualizados: 0 });
        }

        const pedido_ids = trocasAtivas.map(p => p.id);

        console.log(`[sincronizarLogistico] Consultando ${pedido_ids.length} trocas ativas`);

        // Consultar o app logístico
        const response = await fetch(LOGISTICO_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({ pedido_ids })
        });

        if (!response.ok) {
            const errText = await response.text();
            return Response.json({ error: `Erro ao consultar logístico: ${response.status} - ${errText}` }, { status: 502 });
        }

        const data = await response.json();
        const resultados = data.resultados || {};

        // Atualizar status local de cada pedido
        let atualizados = 0;
        let erros = 0;
        const detalhes = {};

        for (const [pedidoId, info] of Object.entries(resultados)) {
            try {
                const updateData = {};
                if (info.status) updateData.status = info.status;
                if (info.numero_carga) updateData.numero_carga = info.numero_carga;

                if (Object.keys(updateData).length > 0) {
                    await base44.asServiceRole.entities.Pedido.update(pedidoId, updateData);
                    atualizados++;
                }
                detalhes[pedidoId] = { sucesso: true, ...info };
            } catch (e) {
                erros++;
                detalhes[pedidoId] = { sucesso: false, erro: e.message };
            }
        }

        return Response.json({
            success: true,
            total_consultados: pedido_ids.length,
            total_atualizados: atualizados,
            total_erros: erros,
            detalhes
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});