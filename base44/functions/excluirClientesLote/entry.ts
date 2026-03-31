import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Usa AlterarClientesPorLote — só atualiza os campos enviados, sem exigir todos os obrigatórios
async function mudarTagLoteOmie(clientesPayload) {
    const payload = {
        call: "AlterarClientesPorLote",
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
            lote: Date.now(),
            clientes_cadastro: clientesPayload
        }]
    };

    const response = await fetch(OMIE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    return await response.json();
}

// Recebe: { clientes: [{ id, codigo }] }
// Muda tag para "Fornecedor" no Omie (AlterarClientesPorLote) e remove do Base44
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

        // Montar payload mínimo: só codigo_cliente_integracao + tags
        const clientesOmie = clientes.map(c => ({
            codigo_cliente_integracao: c.id,
            tags: [{ tag: "Fornecedor" }]
        }));

        // Enviar em lotes de até 50 (limite da API Omie)
        const LOTE = 50;
        for (let i = 0; i < clientes.length; i += LOTE) {
            const loteClientes = clientes.slice(i, i + LOTE);
            const loteOmie = clientesOmie.slice(i, i + LOTE);

            let resultado = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    resultado = await mudarTagLoteOmie(loteOmie);
                } catch (e) {
                    resultado = { faultstring: e.message };
                }
                const fault = (resultado.faultstring || '').toLowerCase();
                if (fault && (fault.includes('too many requests') || fault.includes('já existe uma requisição') || fault.includes('try again'))) {
                    await delay(3000 * Math.pow(2, attempt));
                    continue;
                }
                break;
            }

            // Processar resultado
            if (resultado.faultstring) {
                const fault = (resultado.faultstring || '').toLowerCase();
                if (fault.includes('não encontrado') || fault.includes('não cadastrado')) {
                    // Não existe no Omie — pode remover do Base44
                    loteClientes.forEach(c => idsParaExcluirBase44.push(c.id));
                } else {
                    erros += loteClientes.length;
                    loteClientes.forEach(c => errosList.push(`${c.codigo || c.id}: ${resultado.faultstring}`));
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
                        if (desc.toLowerCase().includes('não encontrado') || desc.toLowerCase().includes('não cadastrado')) {
                            idsParaExcluirBase44.push(item.id);
                        } else {
                            erros++;
                            errosList.push(`${item.codigo || item.id}: ${desc}`);
                        }
                    }
                }
            } else {
                // Sem erro e sem resultado explícito — assumir sucesso
                loteClientes.forEach(c => { idsParaExcluirBase44.push(c.id); transformados++; });
            }

            if (i + LOTE < clientes.length) await delay(500);
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
                    await delay(500);
                    try {
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