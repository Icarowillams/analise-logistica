import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Trocar tag do cliente para "Fornecedor" no Omie via UpsertCliente
async function transformarEmFornecedorOmie(clienteId) {
    try {
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "UpsertCliente",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_cliente_integracao: clienteId,
                    tags: [{ tag: "Fornecedor" }]
                }]
            })
        });
        const resultado = await response.json();
        if (resultado.faultstring) {
            const msg = (resultado.faultstring || '').toLowerCase();
            // Se não existe no Omie, considerar sucesso (pode deletar do Base44)
            if (msg.includes('não encontrado') || msg.includes('não cadastrado')) {
                return { sucesso: true, naoExisteOmie: true };
            }
            if (msg.includes('too many requests') || msg.includes('já existe uma requisição') || msg.includes('try again later') || msg.includes('tente novamente')) {
                return { sucesso: false, rateLimited: true, msg: resultado.faultstring };
            }
            return { sucesso: false, msg: resultado.faultstring };
        }
        return { sucesso: true };
    } catch (e) {
        return { sucesso: false, msg: e.message };
    }
}

// Função dedicada: transforma clientes em Fornecedor no Omie e remove do Base44
// Recebe: { clientes: [{ id, codigo, nome }] }
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { clientes } = await req.json();
        if (!clientes || !Array.isArray(clientes) || clientes.length === 0) {
            return Response.json({ error: 'clientes array obrigatório' }, { status: 400 });
        }

        let ok = 0, erros = 0, transformados = 0;
        const errosList = [];
        const idsParaExcluirBase44 = [];

        // Transformar tag para Fornecedor no Omie, sequencialmente com 300ms entre cada
        for (const item of clientes) {
            const label = `${item.codigo || item.id} - ${item.nome || 'S/N'}`;

            let resultado = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                resultado = await transformarEmFornecedorOmie(item.id);
                if (resultado.sucesso) break;
                if (!resultado.rateLimited) break;
                const waitMs = 2000 * Math.pow(2, attempt);
                console.log(`[excluirClientesLote] Rate limit ${label}, retry ${attempt + 1}, aguardando ${waitMs}ms`);
                await delay(waitMs);
            }

            if (resultado.sucesso) {
                idsParaExcluirBase44.push(item.id);
                if (!resultado.naoExisteOmie) transformados++;
            } else {
                erros++;
                errosList.push(`${label}: ${resultado.msg}`);
            }
            await delay(300);
        }

        // Excluir do Base44 em paralelo
        const deleteResults = await Promise.allSettled(
            idsParaExcluirBase44.map(id => base44.asServiceRole.entities.Cliente.delete(id))
        );
        for (let i = 0; i < deleteResults.length; i++) {
            if (deleteResults[i].status === 'fulfilled') {
                ok++;
            } else {
                try {
                    await delay(1000);
                    await base44.asServiceRole.entities.Cliente.delete(idsParaExcluirBase44[i]);
                    ok++;
                } catch (e) {
                    erros++;
                    errosList.push(`Base44 delete ${idsParaExcluirBase44[i]}: ${e.message}`);
                }
            }
        }

        return Response.json({ sucesso: true, processados: ok, transformados_fornecedor: transformados, erros, erros_detalhes: errosList });
    } catch (error) {
        console.error('[excluirClientesLote] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});