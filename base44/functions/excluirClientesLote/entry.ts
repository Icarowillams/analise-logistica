import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function excluirClienteOmie(clienteId) {
    try {
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ExcluirCliente",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{ codigo_cliente_integracao: clienteId }]
            })
        });
        const resultado = await response.json();
        if (resultado.faultstring) {
            return { sucesso: false, msg: resultado.faultstring };
        }
        return { sucesso: true };
    } catch (e) {
        return { sucesso: false, msg: e.message };
    }
}

function classificar(res) {
    if (res.sucesso) return { sucesso: true };
    const msg = (res.msg || '').toLowerCase();
    if (msg.includes('não encontrado') || msg.includes('não cadastrado')) {
        return { sucesso: true, naoExisteOmie: true };
    }
    if (msg.includes('too many requests') || msg.includes('já existe uma requisição') || msg.includes('try again later') || msg.includes('tente novamente')) {
        return { sucesso: false, rateLimited: true, msg: res.msg };
    }
    return { sucesso: false, msg: res.msg };
}

// Função dedicada e leve para excluir clientes em lote pequeno
// Recebe: { clientes: [{ id, codigo, nome }] }
// Não carrega CSV nem lookups — só faz as exclusões
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

        let ok = 0, erros = 0;
        const errosList = [];
        const idsParaExcluirBase44 = [];

        // Excluir do Omie sequencialmente com 300ms entre cada
        for (const item of clientes) {
            // Tentar até 2 vezes com backoff
            let resultado = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                resultado = classificar(await excluirClienteOmie(item.id));
                if (resultado.sucesso) break;
                if (!resultado.rateLimited) break;
                // Rate limited — esperar 2s, 4s
                await delay(2000 * Math.pow(2, attempt));
            }

            if (resultado.sucesso) {
                idsParaExcluirBase44.push(item.id);
            } else {
                erros++;
                errosList.push(`${item.codigo || item.id} - ${item.nome || 'S/N'}: ${resultado.msg}`);
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
                // Retry uma vez
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

        return Response.json({ sucesso: true, processados: ok, erros, erros_detalhes: errosList });
    } catch (error) {
        console.error('[excluirClientesLote] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});