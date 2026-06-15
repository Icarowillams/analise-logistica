import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/vendedores/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { vendedor_ids, modo = "upsert", lote_inicio = 0 } = body;

        if (!vendedor_ids || !Array.isArray(vendedor_ids) || vendedor_ids.length === 0) {
            return Response.json({ error: 'Informe os IDs dos vendedores para exportar' }, { status: 400 });
        }

        // Processar no máximo 10 vendedores por chamada (Omie tem limite rigoroso de ~50 req/min)
        const LOTE_MAX = 10;
        const vendedoresDoLote = vendedor_ids.slice(lote_inicio, lote_inicio + LOTE_MAX);
        
        if (vendedoresDoLote.length === 0) {
            return Response.json({ 
                concluido: true,
                resumo: { total: 0, sucessos: 0, erros: 0 },
                resultados: []
            });
        }

        // Buscar vendedores
        const vendedores = await base44.entities.Vendedor.list();
        const vendedoresParaExportar = vendedores.filter(v => vendedoresDoLote.includes(v.id));

        const resultados = [];
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (const vendedor of vendedoresParaExportar) {
            // Campos conforme documentação Omie API Vendedores:
            // - codInt: código de integração (nosso ID interno) - string30
            // - nome: nome do vendedor - string70
            // - email: email do vendedor - string100
            // - inativo: S/N - string1
            // - fatura_pedido: S/N - string1
            // - visualiza_pedido: S/N - string1
            // - comissao: percentual de comissão - decimal
            
            const vendedorOmie = {
                codInt: vendedor.id.substring(0, 30),
                nome: (vendedor.nome || "Vendedor sem nome").substring(0, 70),
                email: (vendedor.email || "").substring(0, 100),
                inativo: vendedor.status === 'inativo' ? "S" : "N",
                fatura_pedido: "S",
                visualiza_pedido: "N",
                comissao: 0.5
            };

            const metodo = modo === "incluir" ? "IncluirVendedor" : "UpsertVendedor";

            try {
                const response = await fetch(OMIE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: metodo,
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [vendedorOmie]
                    })
                });

                // Status HTTP ANTES de response.json() — num 5xx/429/425 o corpo não costuma ser JSON.
                let resultado;
                if (response.status >= 500 || response.status === 429 || response.status === 425) {
                    const corpo = await response.text().catch(() => '');
                    resultado = { faultstring: `HTTP ${response.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}` };
                } else {
                    resultado = await response.json();
                }

                resultados.push({
                    vendedor_id: vendedor.id,
                    nome: vendedor.nome,
                    email: vendedor.email,
                    sucesso: !resultado.faultstring,
                    codigo_omie: resultado.codigo || null,
                    mensagem: resultado.faultstring || resultado.descricao || "Exportado com sucesso"
                });
            } catch (err) {
                resultados.push({
                    vendedor_id: vendedor.id,
                    nome: vendedor.nome,
                    email: vendedor.email,
                    sucesso: false,
                    codigo_omie: null,
                    mensagem: err.message
                });
            }

            // Aguardar 3000ms entre requisições para evitar rate limit da Omie
            await delay(3000);
        }

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.filter(r => !r.sucesso).length;
        const proximoLote = lote_inicio + LOTE_MAX;
        const concluido = proximoLote >= vendedor_ids.length;

        return Response.json({
            concluido,
            proximo_lote: concluido ? null : proximoLote,
            total_geral: vendedor_ids.length,
            resumo: {
                total: resultados.length,
                sucessos,
                erros
            },
            resultados
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});