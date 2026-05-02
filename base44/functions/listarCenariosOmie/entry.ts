import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const CENARIOS_URL = "https://app.omie.com.br/api/v1/geral/cenarios/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Doc Omie: máx 100 reg/pág, backoff em rate limit
        async function listarPagina(nPagina, tent = 0) {
            const response = await fetch(CENARIOS_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ListarCenarios",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{ nPagina, nRegPorPagina: 100 }]
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
                    return listarPagina(nPagina, tent + 1);
                }
            }
            return data;
        }

        let todosRegistros = [];
        const primeira = await listarPagina(1);
        if (primeira.faultstring) {
            return Response.json({ sucesso: false, erro: primeira.faultstring, cenarios: [] });
        }
        const totalPaginas = primeira.nTotPaginas || 1;
        todosRegistros = todosRegistros.concat(primeira.cenariosEncontrados || []);

        // Demais páginas em paralelo (3 simultâneas)
        const PARALELISMO = 3;
        const restantes = [];
        for (let p = 2; p <= totalPaginas; p++) restantes.push(p);
        for (let i = 0; i < restantes.length; i += PARALELISMO) {
            const lote = restantes.slice(i, i + PARALELISMO);
            const resultados = await Promise.all(lote.map(p => listarPagina(p)));
            for (const r of resultados) {
                if (r.cenariosEncontrados) todosRegistros = todosRegistros.concat(r.cenariosEncontrados);
            }
            if (i + PARALELISMO < restantes.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // Filtrar apenas cenários ativos
        const cenariosAtivos = todosRegistros.filter(c => c.inativo !== 'S');

        console.log(`[listarCenariosOmie] ${cenariosAtivos.length} cenários fiscais ativos encontrados`);

        return Response.json({
            sucesso: true,
            cenarios: cenariosAtivos.map(c => ({
                codigo: c.nCodigo,
                nome: c.cNome,
                padrao: c.padrao || false,
                industria: c.industria || false,
                comercio_varejista: c.comercioVarejista || false,
                comercio_atacadista: c.comercioAtacadista || false,
                prestador_servico: c.prestadorServico || false
            })),
            total: cenariosAtivos.length
        });

    } catch (error) {
        console.error('[listarCenariosOmie] Erro:', error.message);
        return Response.json({ error: error.message, sucesso: false }, { status: 500 });
    }
});