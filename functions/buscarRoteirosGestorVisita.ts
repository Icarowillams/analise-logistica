import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const gestorVisitaAppId = '68b1f50209adbcb52b0d911b';
        const gestorVisitaApiKey = '60cf11f680fa4a83b1631326d3c773b1';

        const gestorVisitaUrl = `https://app.base44.com/api/apps/${gestorVisitaAppId}/entities/Roteiro`;
        
        const response = await fetch(gestorVisitaUrl, {
            method: 'GET',
            headers: {
                'api_key': gestorVisitaApiKey,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return Response.json({ 
                error: 'Erro ao buscar dados do Gestor Visita',
                details: await response.text()
            }, { status: response.status });
        }

        const roteiros = await response.json();

        return Response.json({
            success: true,
            roteiros,
            total: roteiros.length
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});