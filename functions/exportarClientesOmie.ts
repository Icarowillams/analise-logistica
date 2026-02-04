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
        const { cliente_ids, modo = "upsert" } = body; // modo: "upsert" ou "incluir"

        if (!cliente_ids || !Array.isArray(cliente_ids) || cliente_ids.length === 0) {
            return Response.json({ error: 'Informe os IDs dos clientes para exportar' }, { status: 400 });
        }

        // Buscar clientes do Base44
        const clientes = await base44.entities.Cliente.list();
        const clientesParaExportar = clientes.filter(c => cliente_ids.includes(c.id));

        if (clientesParaExportar.length === 0) {
            return Response.json({ error: 'Nenhum cliente encontrado com os IDs informados' }, { status: 404 });
        }

        // Processar em paralelo (lotes de 50 para máxima velocidade)
        const BATCH_SIZE = 50;
        const resultados = [];

        const processarCliente = async (cliente) => {
            const clienteOmie = {
                codigo_cliente_integracao: cliente.id,
                razao_social: cliente.razao_social || cliente.nome_fantasia || "Cliente sem nome",
                nome_fantasia: cliente.nome_fantasia || cliente.razao_social || "",
                cnpj_cpf: cliente.cpf_cnpj || "",
                email: "",
                endereco: cliente.endereco || "",
                endereco_numero: cliente.numero || "",
                bairro: cliente.bairro || "",
                cidade: cliente.cidade || "",
                estado: cliente.estado || "",
                cep: cliente.cep || "",
                pessoa_fisica: (cliente.cpf_cnpj && cliente.cpf_cnpj.length <= 14) ? "S" : "N"
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

                return {
                    cliente_id: cliente.id,
                    razao_social: cliente.razao_social,
                    sucesso: !resultado.faultstring,
                    codigo_omie: resultado.codigo_cliente_omie || null,
                    mensagem: resultado.faultstring || resultado.descricao_status || "Exportado com sucesso"
                };
            } catch (err) {
                return {
                    cliente_id: cliente.id,
                    razao_social: cliente.razao_social,
                    sucesso: false,
                    codigo_omie: null,
                    mensagem: err.message
                };
            }
        };

        // Processar em lotes paralelos
        for (let i = 0; i < clientesParaExportar.length; i += BATCH_SIZE) {
            const lote = clientesParaExportar.slice(i, i + BATCH_SIZE);
            const resultadosLote = await Promise.all(lote.map(processarCliente));
            resultados.push(...resultadosLote);
        }

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.filter(r => !r.sucesso).length;

        return Response.json({
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