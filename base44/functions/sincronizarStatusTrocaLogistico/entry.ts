import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const LOGISTICO_URL = 'https://app.base44.com/api/functions/consultarStatusTrocaCarga';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = Deno.env.get('BASE_REMOTE_API_KEY');
        if (!apiKey) {
            return Response.json({ error: 'BASE_REMOTE_API_KEY não configurada' }, { status: 500 });
        }

        const payload = await req.json();
        const { pedido_ids } = payload;

        if (!pedido_ids || pedido_ids.length === 0) {
            return Response.json({ error: 'pedido_ids é obrigatório' }, { status: 400 });
        }

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