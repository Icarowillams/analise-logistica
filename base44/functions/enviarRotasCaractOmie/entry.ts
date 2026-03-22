import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_CARACT_URL = "https://app.omie.com.br/api/v1/geral/clientescaract/";

// Rate limit: 350ms entre chamadas Omie
const OMIE_DELAY_MS = 350;
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function enviarCaracteristica(clienteId, rotaNome) {
    // Usa AlterarCaractCliente que funciona como upsert conforme doc Omie:
    // "Caso não encontre a característica um novo cadastro será adicionado"
    const response = await fetch(OMIE_CARACT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            call: "AlterarCaractCliente",
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{
                codigo_cliente_integracao: clienteId,
                campo: "Rotas",
                conteudo: rotaNome
            }]
        })
    });

    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { return { erro: text }; }

    if (result.faultstring) {
        // Se AlterarCaractCliente falhar, tenta IncluirCaractCliente como fallback
        const faultLower = result.faultstring.toLowerCase();
        const isNotFound = faultLower.includes('não encontr') || faultLower.includes('nao encontr');
        
        if (isNotFound) {
            await delay(OMIE_DELAY_MS);
            const inclResponse = await fetch(OMIE_CARACT_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "IncluirCaractCliente",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{
                        codigo_cliente_integracao: clienteId,
                        campo: "Rotas",
                        conteudo: rotaNome
                    }]
                })
            });
            const inclText = await inclResponse.text();
            let inclResult;
            try { inclResult = JSON.parse(inclText); } catch { return { erro: inclText }; }
            if (inclResult.faultstring) {
                return { erro: inclResult.faultstring };
            }
            return { sucesso: true, metodo: 'incluir' };
        }

        return { erro: result.faultstring };
    }

    return { sucesso: true, metodo: 'alterar' };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Acesso negado' }, { status: 403 });
        }

        const body = await req.json();
        const { action, cliente_ids } = body;

        // === CONSOLIDAR ===
        if (action === 'consolidar') {
            const clientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 5000);
            const rotas = await base44.asServiceRole.entities.Rota.list();
            const rotasMap = {};
            rotas.forEach(r => { rotasMap[r.id] = r; });

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

            return Response.json({
                sucesso: true,
                total_clientes: clientes.length,
                total_com_rota: consolidado.length,
                total_sem_rota: clientes.length - consolidado.length,
                clientes: consolidado,
            });
        }

        // === ENVIAR LOTE ===
        // Recebe um array de { cliente_id, rota_nome } para processar
        if (action === 'enviar_lote') {
            if (!cliente_ids || !Array.isArray(cliente_ids) || cliente_ids.length === 0) {
                return Response.json({ error: 'cliente_ids obrigatório (array de {cliente_id, rota_nome})' }, { status: 400 });
            }

            // Limitar a 30 por lote como segurança
            const lote = cliente_ids.slice(0, 30);
            const resultados = [];
            let sucesso = 0;
            let erros = 0;

            for (const item of lote) {
                const resultado = await enviarCaracteristica(item.cliente_id, item.rota_nome);
                if (resultado.sucesso) {
                    sucesso++;
                    resultados.push({ cliente_id: item.cliente_id, sucesso: true });
                } else {
                    erros++;
                    resultados.push({ cliente_id: item.cliente_id, erro: resultado.erro });
                }
                await delay(OMIE_DELAY_MS);
            }

            return Response.json({
                sucesso: true,
                total_enviados: sucesso,
                total_erros: erros,
                resultados,
            });
        }

        return Response.json({ error: 'Action inválida. Use "consolidar" ou "enviar_lote".' }, { status: 400 });

    } catch (error) {
        console.error('[enviarRotasCaractOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});