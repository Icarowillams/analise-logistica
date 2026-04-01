import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ============================================================================
// ESPELHAR BASE44 → OMIE
// Envia TODOS os clientes do Base44 para o Omie via UpsertCliente (em lotes)
// e opcionalmente exclui do Omie os que não existem no Base44.
//
// Etapas:
//   analise      → Conta clientes no Base44, retorna total para envio
//   enviar_omie  → Envia um lote de clientes do Base44 para o Omie
//   listar_omie  → Lista clientes do Omie (paginado) para identificar excedentes
//   excluir_omie → Exclui do Omie clientes que não existem no Base44
// ============================================================================

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function extrairCodigoOmieDoErro(mensagem) {
    const match = (mensagem || '').match(/Id \[(\d+)\]/i);
    return match ? Number(match[1]) : null;
}

function erroEhRateLimit(resultado) {
    const fault = (resultado?.faultstring || '').toLowerCase();
    return fault.includes('too many requests') || fault.includes('já existe uma requisição') || fault.includes('ja existe uma requisicao') || fault.includes('try again') || fault.includes('tente novamente');
}

async function chamarOmieComRetry(callName, param, maxRetries = 2) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: callName,
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [param]
            })
        });
        const resultado = await response.json();
        const fault = (resultado.faultstring || '').toLowerCase();
        if (fault && (fault.includes('too many requests') || fault.includes('já existe uma requisição') || fault.includes('try again') || fault.includes('tente novamente'))) {
            const waitMs = 2000 * Math.pow(2, attempt);
            console.log(`[omie] Rate limit ${callName}, retry ${attempt + 1}/${maxRetries}, aguardando ${waitMs}ms`);
            await delay(waitMs);
            continue;
        }
        return resultado;
    }
    return { faultstring: 'Rate limit persistente após todas tentativas' };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { etapa, offset = 0, batch_size = 20, pagina_omie = 1, ids_excluir = [] } = await req.json();

        // =====================================================================
        // ANÁLISE — retorna total de clientes no Base44
        // =====================================================================
        if (etapa === 'analise') {
            const clientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
            return Response.json({
                sucesso: true,
                total: clientes.length,
            });
        }

        // =====================================================================
        // ENVIAR OMIE — Envia clientes do Base44 para o Omie via UpsertCliente
        // =====================================================================
        if (etapa === 'enviar_omie') {
            const clientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
            const bulkSize = Math.min(batch_size, 5);
            const lote = clientes.slice(offset, offset + bulkSize);
            let ok = 0, erros = 0;
            const errosList = [];

            for (const c of lote) {
                const cnpj = (c.cpf_cnpj || '').replace(/[.\-\/\s]/g, '');
                const isPF = cnpj.length <= 11;
                const clienteOmie = {
                    codigo_cliente_integracao: c.id,
                    razao_social: (c.razao_social || c.nome_fantasia || 'Cliente').substring(0, 60),
                    nome_fantasia: (c.nome_fantasia || c.razao_social || '').substring(0, 100),
                    cnpj_cpf: cnpj,
                    pessoa_fisica: isPF ? 'S' : 'N',
                    endereco: (c.endereco || '').substring(0, 60),
                    endereco_numero: (c.numero || 'S/N').substring(0, 10),
                    bairro: (c.bairro || '').substring(0, 60),
                    cidade: (c.cidade || '').substring(0, 60),
                    estado: (c.estado || 'PE').substring(0, 2),
                    cep: (c.cep || '').replace(/\D/g, '').substring(0, 8) || '50000000',
                    email: (c.email || 'nfe@paoemel.com.br').substring(0, 500),
                    contribuinte: isPF ? 'N' : 'S',
                    inscricao_estadual: isPF ? 'ISENTO' : (c.inscricao_estadual || ''),
                    inativo: (c.status || 'ativo') === 'inativo' ? 'S' : 'N',
                    tags: c.codigo ? [{ tag: `COD:${c.codigo}` }] : [],
                };

                let resultado = await chamarOmieComRetry("UpsertClienteCpfCnpj", clienteOmie, 2);

                const codigoOmieExistente = extrairCodigoOmieDoErro(resultado.faultstring);
                if (resultado.faultstring && codigoOmieExistente) {
                    const associacao = await chamarOmieComRetry("AssociarCodIntCliente", {
                        codigo_cliente_omie: codigoOmieExistente,
                        codigo_cliente_integracao: c.id
                    }, 2);

                    if (!associacao.faultstring) {
                        resultado = await chamarOmieComRetry("UpsertCliente", {
                            ...clienteOmie,
                            codigo_cliente_omie: codigoOmieExistente
                        }, 2);
                    }
                }

                if (resultado.faultstring) {
                    erros++;
                    errosList.push(`${c.codigo || c.id} - ${c.razao_social}: ${resultado.faultstring}`);
                } else {
                    ok++;
                }
                await delay(250);
            }

            const nextOffset = offset + bulkSize;
            return Response.json({
                sucesso: true,
                total: clientes.length,
                processados: ok,
                erros,
                offset,
                nextOffset: nextOffset < clientes.length ? nextOffset : null,
                concluido: nextOffset >= clientes.length,
                erros_detalhes: errosList,
            });
        }

        // =====================================================================
        // LISTAR OMIE — Lista clientes do Omie paginado
        // =====================================================================
        if (etapa === 'listar_omie') {
            const response = await fetch(OMIE_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ListarClientes",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{ pagina: pagina_omie, registros_por_pagina: 500 }]
                })
            });
            const resultado = await response.json();
            if (resultado.faultstring) {
                return Response.json({ error: resultado.faultstring }, { status: 400 });
            }

            const clientes = (resultado.clientes_cadastro || []).map(c => ({
                codigo_omie: c.codigo_cliente_omie,
                codigo_integracao: c.codigo_cliente_integracao,
                razao_social: c.razao_social || '',
                cnpj_cpf: c.cnpj_cpf || '',
            }));

            return Response.json({
                sucesso: true,
                pagina: pagina_omie,
                total_paginas: resultado.total_de_paginas || 1,
                total_registros: resultado.total_de_registros || 0,
                clientes,
            });
        }

        // =====================================================================
        // EXCLUIR OMIE — Exclui do Omie por codigo_cliente_integracao
        // Receber ids_excluir no mesmo body: [{codigo_integracao, razao_social}]
        // =====================================================================
        if (etapa === 'excluir_omie') {
            // ids_excluir já vem do body parseado no topo
            let ok = 0, erros = 0;
            const errosList = [];

            for (const item of (ids_excluir || [])) {
                const resultado = await chamarOmieComRetry("ExcluirCliente", {
                    codigo_cliente_integracao: item.codigo_integracao
                }, 3);
                const fault = (resultado.faultstring || '').toLowerCase();
                if (!resultado.faultstring || fault.includes('não encontrado') || fault.includes('não cadastrado')) {
                    ok++;
                } else {
                    erros++;
                    errosList.push(`${item.razao_social}: ${resultado.faultstring}`);
                }
                await delay(350);
            }

            return Response.json({
                sucesso: true,
                processados: ok,
                erros,
                erros_detalhes: errosList,
            });
        }

        return Response.json({ error: 'etapa inválida' }, { status: 400 });
    } catch (error) {
        console.error('[espelharBase44Omie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});