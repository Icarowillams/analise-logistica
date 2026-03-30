import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const LOGISTICO_URL = Deno.env.get('LOGISTICO_FUNCTION_URL');
        if (!LOGISTICO_URL) {
            return Response.json({ error: 'LOGISTICO_FUNCTION_URL não configurada' }, { status: 500 });
        }

        const apiKey = Deno.env.get('BASE_REMOTE_API_KEY');
        if (!apiKey) {
            return Response.json({ error: 'BASE_REMOTE_API_KEY não configurada' }, { status: 500 });
        }

        const body = await req.json();
        const { pedido_ids } = body;

        if (!pedido_ids || !Array.isArray(pedido_ids) || pedido_ids.length === 0) {
            return Response.json({ error: 'pedido_ids é obrigatório (array)' }, { status: 400 });
        }

        console.log(`[consultarCarregamentoLogistico] Consultando ${pedido_ids.length} pedidos`);

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
            console.error(`[consultarCarregamentoLogistico] Erro: ${response.status} - ${errText}`);
            return Response.json({ error: `Erro ao consultar logístico: ${response.status}` }, { status: 502 });
        }

        const data = await response.json();
        const resultados = data.resultados || {};

        // Extrair apenas o numero_carregamento de cada pedido
        const carregamentos = {};
        for (const [pedidoId, info] of Object.entries(resultados)) {
            carregamentos[pedidoId] = info.numero_carregamento || info.numero_carga || null;
        }

        return Response.json({ sucesso: true, carregamentos });

    } catch (error) {
        console.error('[consultarCarregamentoLogistico] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});