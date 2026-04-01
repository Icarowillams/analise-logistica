import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function listarClientesOmie(pagina = 1, registrosPorPagina = 500) {
    const response = await fetch(OMIE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            call: "ListarClientes",
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{
                pagina,
                registros_por_pagina: registrosPorPagina,
                clientesFiltro: { }
            }]
        })
    });
    return await response.json();
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { acao, pagina_omie } = body;
        // acao: 'listar_omie' (paginado), 'comparar' (busca tudo e compara)

        if (acao === 'listar_omie') {
            // Retorna uma página de clientes do Omie
            const pag = pagina_omie || 1;
            const resultado = await listarClientesOmie(pag, 50);
            
            if (resultado.faultstring) {
                return Response.json({ error: resultado.faultstring }, { status: 400 });
            }

            const clientes = (resultado.clientes_cadastro || []).map(c => ({
                codigo_omie: c.codigo_cliente_omie,
                codigo_integracao: c.codigo_cliente_integracao,
                razao_social: c.razao_social || '',
                nome_fantasia: c.nome_fantasia || '',
                cnpj_cpf: c.cnpj_cpf || '',
                endereco: c.endereco || '',
                endereco_numero: c.endereco_numero || '',
                bairro: c.bairro || '',
                cidade: c.cidade || '',
                estado: c.estado || '',
                cep: c.cep || '',
                email: c.email || '',
                inscricao_estadual: c.inscricao_estadual || '',
                inativo: c.inativo || 'N',
                tags: (c.tags || []).map(t => t.tag).join(', '),
                pessoa_fisica: c.pessoa_fisica || 'N',
            }));

            return Response.json({
                sucesso: true,
                pagina: pag,
                total_paginas: resultado.total_de_paginas || 1,
                total_registros: resultado.total_de_registros || 0,
                clientes
            });
        }

        if (acao === 'comparar') {
            // Buscar TODOS os clientes do Omie (paginado)
            let todosOmie = [];
            let pagina = 1;
            let totalPaginas = 1;

            while (pagina <= totalPaginas) {
                const resultado = await listarClientesOmie(pagina, 500);
                if (resultado.faultstring) {
                    return Response.json({ error: `Erro Omie pag ${pagina}: ${resultado.faultstring}` }, { status: 400 });
                }
                totalPaginas = resultado.total_de_paginas || 1;
                const clientes = resultado.clientes_cadastro || [];
                todosOmie.push(...clientes);
                pagina++;
                if (pagina <= totalPaginas) await delay(500);
            }

            // Buscar todos os clientes do Base44 com paginação
            const clientesBase44 = [];
            const PAGE_SIZE = 500;
            let skip = 0;

            while (true) {
                const lote = await base44.asServiceRole.entities.Cliente.list('-created_date', PAGE_SIZE, skip);
                const registros = Array.isArray(lote) ? lote : [];
                clientesBase44.push(...registros);

                if (registros.length < PAGE_SIZE) break;
                skip += PAGE_SIZE;
            }

            // Indexar Omie por id de integração, por código e por CPF/CNPJ normalizado
            const omieMapPorId = {};
            const omieMapPorCpfCnpj = {};
            todosOmie.forEach(c => {
                const codigoIntegracao = (c.codigo_cliente_integracao || '').trim();
                const cpfCnpj = (c.cnpj_cpf || '').replace(/\D/g, '');
                if (codigoIntegracao) omieMapPorId[codigoIntegracao] = c;
                if (cpfCnpj) omieMapPorCpfCnpj[cpfCnpj] = c;
            });

            const base44Ids = new Set(clientesBase44.map(c => c.id));
            const base44Codigos = new Set(clientesBase44.map(c => c.codigo).filter(Boolean));

            // Clientes no Base44 — considerar existente se bater por código, ID de integração OU CPF/CNPJ
            for (const cb of clientesBase44) {
                const cpfCnpjBase44 = (cb.cpf_cnpj || '').replace(/\D/g, '');
                const co = (cb.codigo && omieMapPorId[cb.codigo]) || omieMapPorId[cb.id] || omieMapPorCpfCnpj[cpfCnpjBase44];

                if (!co) {
                    soNoBase44.push({
                        id: cb.id,
                        codigo: cb.codigo,
                        razao_social: cb.razao_social,
                        nome_fantasia: cb.nome_fantasia,
                        cpf_cnpj: cb.cpf_cnpj,
                        status: cb.status,
                    });
                    continue;
                }

                const diffs = [];
                const comparar = [
                    ['razao_social', cb.razao_social || '', (co.razao_social || '').substring(0, 60)],
                    ['nome_fantasia', cb.nome_fantasia || '', co.nome_fantasia || ''],
                    ['cnpj_cpf', cpfCnpjBase44, (co.cnpj_cpf || '').replace(/\D/g, '')],
                    ['endereco', cb.endereco || '', co.endereco || ''],
                    ['numero', cb.numero || '', co.endereco_numero || ''],
                    ['bairro', cb.bairro || '', co.bairro || ''],
                    ['cidade', cb.cidade || '', co.cidade || ''],
                    ['estado', (cb.estado || '').toUpperCase().substring(0, 2), (co.estado || '').toUpperCase().substring(0, 2)],
                    ['cep', (cb.cep || '').replace(/\D/g, ''), (co.cep || '').replace(/\D/g, '')],
                    ['inativo', cb.status === 'inativo' ? 'S' : 'N', co.inativo || 'N'],
                ];

                for (const [campo, valBase44, valOmie] of comparar) {
                    const a = (valBase44 || '').toString().trim().toUpperCase();
                    const b = (valOmie || '').toString().trim().toUpperCase();
                    if (a !== b) {
                        diffs.push({ campo, base44: valBase44, omie: valOmie });
                    }
                }

                if (diffs.length > 0) {
                    diferentes.push({
                        id: cb.id,
                        codigo: cb.codigo,
                        razao_social: cb.razao_social,
                        nome_fantasia: cb.nome_fantasia,
                        diffs
                    });
                } else {
                    iguais++;
                }
            }

            // Clientes no Omie que NÃO estão no Base44 por ID e nem por CPF/CNPJ
            const base44CpfCnpjSet = new Set(
                clientesBase44.map(c => (c.cpf_cnpj || '').replace(/\D/g, '')).filter(Boolean)
            );

            for (const co of todosOmie) {
                const codigoIntegracao = (co.codigo_cliente_integracao || '').trim();
                const cpfCnpj = (co.cnpj_cpf || '').replace(/\D/g, '');
                const existeNoBase44 = (codigoIntegracao && (base44Ids.has(codigoIntegracao) || base44Codigos.has(codigoIntegracao))) || (cpfCnpj && base44CpfCnpjSet.has(cpfCnpj));

                if (!existeNoBase44) {
                    soNoOmie.push({
                        codigo_omie: co.codigo_cliente_omie,
                        codigo_integracao: co.codigo_cliente_integracao,
                        razao_social: co.razao_social,
                        nome_fantasia: co.nome_fantasia,
                        cnpj_cpf: co.cnpj_cpf,
                        inativo: co.inativo,
                        tags: (co.tags || []).map(t => t.tag).join(', '),
                    });
                }
            }

            return Response.json({
                sucesso: true,
                total_omie: todosOmie.length,
                total_base44: clientesBase44.length,
                iguais,
                diferentes: diferentes.length,
                so_no_base44: soNoBase44.length,
                so_no_omie: soNoOmie.length,
                lista_diferentes: diferentes,
                lista_so_base44: soNoBase44,
                lista_so_omie: soNoOmie,
            });
        }

        return Response.json({ error: 'acao inválida (listar_omie, comparar)' }, { status: 400 });

    } catch (error) {
        console.error('[consultarClientesOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});