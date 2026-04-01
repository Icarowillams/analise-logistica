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

        // Listar todos os cenários fiscais do Omie (paginado)
        let todosRegistros = [];
        let pagina = 1;
        let totalPaginas = 1;

        while (pagina <= totalPaginas) {
            const response = await fetch(CENARIOS_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ListarCenarios",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{ nPagina: pagina, nRegPorPagina: 50 }]
                })
            });

            const data = await response.json();

            if (data.faultstring) {
                return Response.json({ 
                    sucesso: false, 
                    erro: data.faultstring,
                    cenarios: [] 
                });
            }

            totalPaginas = data.nTotPaginas || 1;
            const encontrados = data.cenariosEncontrados || [];
            todosRegistros = todosRegistros.concat(encontrados);
            pagina++;
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