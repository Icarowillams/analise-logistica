import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_CARACT_URL = "https://app.omie.com.br/api/v1/geral/clientescaract/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Acesso negado' }, { status: 403 });
        }

        const body = await req.json();
        const { action, cliente_ids } = body;

        // action = "consolidar" -> retorna a lista de clientes com suas rotas
        // action = "enviar" -> envia as características para o Omie

        const clientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 5000);
        const rotas = await base44.asServiceRole.entities.Rota.list();

        const rotasMap = {};
        rotas.forEach(r => { rotasMap[r.id] = r; });

        // Consolidar: para cada cliente, encontrar a rota vinculada
        const consolidado = clientes
            .filter(c => c.rota_id && rotasMap[c.rota_id])
            .map(c => ({
                cliente_id: c.id,
                codigo: c.codigo,
                razao_social: c.razao_social,
                nome_fantasia: c.nome_fantasia,
                cpf_cnpj: c.cpf_cnpj,
                rota_id: c.rota_id,
                rota_nome: rotasMap[c.rota_id]?.nome || '',
                status: c.status,
            }));

        if (action === 'consolidar') {
            return Response.json({
                sucesso: true,
                total_clientes: clientes.length,
                total_com_rota: consolidado.length,
                total_sem_rota: clientes.length - consolidado.length,
                clientes: consolidado,
            });
        }

        if (action === 'enviar') {
            // Filtrar apenas os clientes selecionados (ou todos se não informado)
            let clientesParaEnviar = consolidado;
            if (cliente_ids && cliente_ids.length > 0) {
                const idsSet = new Set(cliente_ids);
                clientesParaEnviar = consolidado.filter(c => idsSet.has(c.cliente_id));
            }

            const resultados = [];
            let sucesso = 0;
            let erros = 0;

            for (const cliente of clientesParaEnviar) {
                try {
                    const response = await fetch(OMIE_CARACT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            call: "IncluirCaractCliente",
                            app_key: OMIE_APP_KEY,
                            app_secret: OMIE_APP_SECRET,
                            param: [{
                                codigo_cliente_integracao: cliente.cliente_id,
                                campo: "Rotas",
                                conteudo: cliente.rota_nome
                            }]
                        })
                    });

                    const text = await response.text();
                    let result;
                    try { result = JSON.parse(text); } catch { result = { faultstring: text }; }

                    if (result.faultstring) {
                        // Se já existe, tenta alterar
                        if (result.faultstring.includes('já existe') || result.faultstring.includes('ja existe')) {
                            const altResponse = await fetch(OMIE_CARACT_URL, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    call: "AlterarCaractCliente",
                                    app_key: OMIE_APP_KEY,
                                    app_secret: OMIE_APP_SECRET,
                                    param: [{
                                        codigo_cliente_integracao: cliente.cliente_id,
                                        campo: "Rotas",
                                        conteudo: cliente.rota_nome
                                    }]
                                })
                            });
                            const altResult = await altResponse.json();
                            if (altResult.faultstring) {
                                erros++;
                                resultados.push({ cliente_id: cliente.cliente_id, razao_social: cliente.razao_social, erro: altResult.faultstring });
                            } else {
                                sucesso++;
                                resultados.push({ cliente_id: cliente.cliente_id, razao_social: cliente.razao_social, sucesso: true, alterado: true });
                            }
                        } else {
                            erros++;
                            resultados.push({ cliente_id: cliente.cliente_id, razao_social: cliente.razao_social, erro: result.faultstring });
                        }
                    } else {
                        sucesso++;
                        resultados.push({ cliente_id: cliente.cliente_id, razao_social: cliente.razao_social, sucesso: true });
                    }

                    // Rate limit do Omie
                    await new Promise(r => setTimeout(r, 350));

                } catch (e) {
                    erros++;
                    resultados.push({ cliente_id: cliente.cliente_id, razao_social: cliente.razao_social, erro: e.message });
                }
            }

            return Response.json({
                sucesso: true,
                total_enviados: sucesso,
                total_erros: erros,
                resultados,
            });
        }

        return Response.json({ error: 'Action inválida. Use "consolidar" ou "enviar".' }, { status: 400 });

    } catch (error) {
        console.error('[enviarRotasCaractOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});