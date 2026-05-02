import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Doc Omie: máx 100 reg/pág, backoff em rate limit (425/520/429)
        async function listarPag(tent = 0) {
            const response = await fetch("https://app.omie.com.br/api/v1/produtos/etapafat/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ListarEtapasFaturamento",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{ pagina: 1, registros_por_pagina: 100 }]
                })
            });
            const data = await response.json();
            if (data.faultstring) {
                const msg = String(data.faultstring).toLowerCase();
                const fc = String(data.faultcode || '');
                const isRate = msg.includes('limite de requisi') || msg.includes('cota') || msg.includes('aguarde')
                    || fc.includes('425') || fc.includes('520') || response.status === 429;
                if (isRate && tent < 4) {
                    await new Promise(r => setTimeout(r, 2000 * (tent + 1)));
                    return listarPag(tent + 1);
                }
            }
            return data;
        }
        const result = await listarPag();
        console.log('[listarEtapasOmie] Resultado:', JSON.stringify(result));
        return Response.json(result);
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});