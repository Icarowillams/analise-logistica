import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { cliente_ids, modo = "upsert", lote_inicio = 0 } = body;

        if (!cliente_ids || !Array.isArray(cliente_ids) || cliente_ids.length === 0) {
            return Response.json({ error: 'Informe os IDs dos clientes para exportar' }, { status: 400 });
        }

        // Processar no máximo 100 clientes por chamada (para não dar timeout)
        const LOTE_MAX = 100;
        const clientesDoLote = cliente_ids.slice(lote_inicio, lote_inicio + LOTE_MAX);
        
        if (clientesDoLote.length === 0) {
            return Response.json({ 
                concluido: true,
                resumo: { total: 0, sucessos: 0, erros: 0 },
                resultados: []
            });
        }

        // Buscar clientes do Base44
        const clientes = await base44.entities.Cliente.list();
        const clientesParaExportar = clientes.filter(c => clientesDoLote.includes(c.id));

        const resultados = [];
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (const cliente of clientesParaExportar) {
            // Validar e limpar dados antes de enviar
            const estado = (cliente.estado || "").replace(/[^a-zA-Z]/g, "").substring(0, 2).toUpperCase();
            const cpfCnpj = (cliente.cpf_cnpj || "").replace(/[^\d]/g, "");
            
            const clienteOmie = {
                codigo_cliente_integracao: cliente.id,
                razao_social: (cliente.razao_social || cliente.nome_fantasia || "Cliente sem nome").substring(0, 60),
                nome_fantasia: (cliente.nome_fantasia || cliente.razao_social || "").substring(0, 60),
                cnpj_cpf: cpfCnpj,
                email: "",
                endereco: (cliente.endereco || "N/A").substring(0, 60),
                endereco_numero: (cliente.numero || "S/N").substring(0, 10),
                bairro: (cliente.bairro || "N/A").substring(0, 60),
                cidade: (cliente.cidade || "N/A").substring(0, 40),
                estado: estado || "PE",
                cep: (cliente.cep || "00000000").replace(/[^\d]/g, "").substring(0, 8),
                pessoa_fisica: cpfCnpj.length <= 11 ? "S" : "N"
            };

            const metodo = modo === "incluir" ? "IncluirCliente" : "UpsertCliente";

            try {
                const response = await fetch(OMIE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: metodo,
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [clienteOmie]
                    })
                });

                const resultado = await response.json();

                resultados.push({
                    cliente_id: cliente.id,
                    razao_social: cliente.razao_social,
                    sucesso: !resultado.faultstring,
                    codigo_omie: resultado.codigo_cliente_omie || null,
                    mensagem: resultado.faultstring || resultado.descricao_status || "Exportado com sucesso"
                });
            } catch (err) {
                resultados.push({
                    cliente_id: cliente.id,
                    razao_social: cliente.razao_social,
                    sucesso: false,
                    codigo_omie: null,
                    mensagem: err.message
                });
            }

            // Aguardar 350ms entre requisições (limite Omie: 3 req/seg)
            await delay(350);
        }

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.filter(r => !r.sucesso).length;
        const proximoLote = lote_inicio + LOTE_MAX;
        const concluido = proximoLote >= cliente_ids.length;

        return Response.json({
            concluido,
            proximo_lote: concluido ? null : proximoLote,
            total_geral: cliente_ids.length,
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