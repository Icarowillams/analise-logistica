import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Usa UpsertClientesPorLote para mudar tag de até 50 clientes de uma vez
async function mudarTagLoteOmie(clientesOmie) {
    const payload = {
        call: "UpsertClientesPorLote",
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
            lote: Date.now(),
            clientes_cadastro: clientesOmie
        }]
    };

    try {
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const resultado = await response.json();
        return resultado;
    } catch (e) {
        return { faultstring: e.message };
    }
}

// Função dedicada: muda tag para "Fornecedor" no Omie em lote e remove do Base44
// Recebe: { clientes: [{ id, codigo, nome, cpf_cnpj, razao_social }] }
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

        let transformados = 0, erros = 0;
        const errosList = [];
        const idsParaExcluirBase44 = [];

        // Montar payloads Omie com campos obrigatórios
        const clientesOmieMap = clientes.map(c => ({
            codigo_cliente_integracao: c.id,
            razao_social: c.razao_social || c.nome || 'Cliente',
            cnpj_cpf: c.cpf_cnpj || '',
            tags: [{ tag: "Fornecedor" }]
        }));

        // Enviar em lotes de até 50 para o Omie (limite da API)
        const LOTE_OMIE = 50;
        for (let i = 0; i < clientes.length; i += LOTE_OMIE) {
            const loteClientes = clientes.slice(i, i + LOTE_OMIE);
            const loteOmie = clientesOmieMap.slice(i, i + LOTE_OMIE);

            let resultado = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                resultado = await mudarTagLoteOmie(loteOmie);
                const fault = (resultado.faultstring || '').toLowerCase();
                if (fault && (fault.includes('too many requests') || fault.includes('já existe uma requisição') || fault.includes('try again later'))) {
                    const waitMs = 3000 * Math.pow(2, attempt);
                    console.log(`[mudarTag] Rate limit lote ${i}, retry ${attempt + 1}, aguardando ${waitMs}ms`);
                    await delay(waitMs);
                    continue;
                }
                break;
            }

            // Processar resultado
            if (resultado.faultstring) {
                const fault = (resultado.faultstring || '').toLowerCase();
                if (fault.includes('não encontrado') || fault.includes('não cadastrado')) {
                    loteClientes.forEach(c => idsParaExcluirBase44.push(c.id));
                } else {
                    erros += loteClientes.length;
                    loteClientes.forEach(c => {
                        errosList.push(`${c.codigo || c.id}: ${resultado.faultstring}`);
                    });
                }
            } else if (resultado.resultado) {
                const resultados = Array.isArray(resultado.resultado) ? resultado.resultado : [resultado.resultado];
                for (let j = 0; j < loteClientes.length; j++) {
                    const item = loteClientes[j];
                    const res = resultados[j];
                    if (!res || res.codigo_status === '0' || res.codigo_status === 0 || !res.codigo_status) {
                        idsParaExcluirBase44.push(item.id);
                        transformados++;
                    } else {
                        const desc = res.descricao_status || 'Erro';
                        const descL = desc.toLowerCase();
                        if (descL.includes('não encontrado') || descL.includes('não cadastrado')) {
                            idsParaExcluirBase44.push(item.id);
                        } else {
                            erros++;
                            errosList.push(`${item.codigo || item.id}: ${desc}`);
                        }
                    }
                }
            } else {
                // Sem faultstring e sem resultado — assumir sucesso
                loteClientes.forEach(c => {
                    idsParaExcluirBase44.push(c.id);
                    transformados++;
                });
            }

            if (i + LOTE_OMIE < clientes.length) await delay(500);
        }

        // Excluir do Base44 em paralelo (lotes de 10)
        let ok = 0;
        for (let i = 0; i < idsParaExcluirBase44.length; i += 10) {
            const chunk = idsParaExcluirBase44.slice(i, i + 10);
            const results = await Promise.allSettled(
                chunk.map(id => base44.asServiceRole.entities.Cliente.delete(id))
            );
            for (let j = 0; j < results.length; j++) {
                if (results[j].status === 'fulfilled') {
                    ok++;
                } else {
                    try {
                        await delay(500);
                        await base44.asServiceRole.entities.Cliente.delete(chunk[j]);
                        ok++;
                    } catch (e) {
                        erros++;
                        errosList.push(`Base44 delete ${chunk[j]}: ${e.message}`);
                    }
                }
            }
        }

        return Response.json({ sucesso: true, processados: ok, transformados_fornecedor: transformados, erros, erros_detalhes: errosList });
    } catch (error) {
        console.error('[excluirClientesLote] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});