import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const header = lines[0].split(';').map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(';');
        const obj = {};
        header.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
        rows.push(obj);
    }
    return rows;
}

function parseLat(raw) {
    if (!raw || raw === '0') return 0;
    const s = raw.replace(/\./g, '');
    const num = parseFloat(s);
    if (isNaN(num)) return 0;
    return num / 100000000;
}

function parseLng(raw) {
    if (!raw || raw === '0') return 0;
    const s = raw.replace(/\./g, '');
    const num = parseFloat(s);
    if (isNaN(num)) return 0;
    return num / 100000000;
}

function normalizeStr(s) {
    return (s || '').toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizePlano(csv_val) {
    if (!csv_val || csv_val === '0') return 'AVISTA';
    const v = csv_val.toUpperCase().trim();
    if (v === 'A VISTA') return 'AVISTA';
    return v;
}

function normalizeCobranca(csv_val) {
    if (!csv_val || csv_val === '0') return 'PIX';
    const v = csv_val.toUpperCase().trim();
    const map = {
        'BOLETO BANCARIO': 'BOELTO BANCARIO',
        'PIX': 'PIX',
        'DINHEIRO': 'DINHEIRO',
        'PIX A PRAZO': 'PIX A PRAZO',
        'TRANSFERENCIA BANCO': 'TRANSFERENCIA',
        'CARTAO DE DEBITO': 'PIX',
        'CARTEIRA': 'PIX',
    };
    return map[v] || 'PIX';
}

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
            const erroLower = resultado.faultstring.toLowerCase();
            if (erroLower.includes('não encontrado') || erroLower.includes('não cadastrado')) {
                return { sucesso: true };
            }
            return { sucesso: false, msg: resultado.faultstring };
        }
        return { sucesso: true };
    } catch (e) {
        return { sucesso: false, msg: e.message };
    }
}

// Wrapper que classifica erros do Omie (rate limit vs erro real)
async function tentarExcluirOmie(item) {
    const res = await excluirClienteOmie(item.id);
    if (res.sucesso) return { sucesso: true };
    const msg = (res.msg || '').toLowerCase();
    const isRateLimit = msg.includes('too many requests') || 
                        msg.includes('já existe uma requisição') ||
                        msg.includes('try again later') ||
                        msg.includes('tente novamente');
    if (isRateLimit) return { sucesso: false, rateLimited: true, msg: res.msg };
    return { sucesso: false, rateLimited: false, msg: res.msg };
}

function buildLookups(planos, tabelas, segmentos, redes, rotas, vendedores, modalidades) {
    const planoMap = {};
    planos.forEach(p => { planoMap[normalizeStr(p.nome)] = p.id; });

    const tabelaMap = {};
    tabelas.forEach(t => { tabelaMap[normalizeStr(t.nome)] = t.id; });

    const segmentoMap = {};
    segmentos.forEach(s => { segmentoMap[normalizeStr(s.nome)] = s.id; });

    const redeMap = {};
    redes.forEach(r => { redeMap[normalizeStr(r.nome)] = r.id; });

    const rotaMap = {};
    rotas.forEach(r => { rotaMap[normalizeStr(r.nome)] = r.id; });

    const vendedorList = vendedores.map(v => ({ id: v.id, nome: normalizeStr(v.nome), supervisor_id: v.supervisor_id }));

    const modalidadeMap = {};
    modalidades.forEach(m => { modalidadeMap[normalizeStr(m.nome)] = m.id; });

    return { planoMap, tabelaMap, segmentoMap, redeMap, rotaMap, vendedorList, modalidadeMap };
}

function findPlanoId(csvVal, planoMap) {
    const norm = normalizeStr(normalizePlano(csvVal));
    return planoMap[norm] || planoMap['AVISTA'] || '';
}

function findTabelaId(csvVal, tabelaMap) {
    const norm = normalizeStr(csvVal);
    if (!norm) return '';
    if (tabelaMap[norm]) return tabelaMap[norm];
    for (const [key, id] of Object.entries(tabelaMap)) {
        if (key.includes(norm) || norm.includes(key)) return id;
    }
    return '';
}

function findRotaId(csvVal, rotaMap) {
    const norm = normalizeStr(csvVal);
    if (!norm) return '';
    if (rotaMap[norm]) return rotaMap[norm];
    for (const [key, id] of Object.entries(rotaMap)) {
        const kn = key.replace(/\s+/g, ' ');
        const nn = norm.replace(/\s+/g, ' ');
        if (kn.includes(nn) || nn.includes(kn)) return id;
    }
    if (norm.includes('DELIVERY')) return rotaMap[normalizeStr('RETIRADA')] || '';
    if (norm.includes('APLICATIVO')) return rotaMap[normalizeStr('APLICATIVO B2B')] || '';
    return '';
}

function findVendedorId(csvVal, vendedorList) {
    const norm = normalizeStr(csvVal);
    if (!norm || norm === 'BALCAO' || norm === 'APLICATIVO') return '';
    const exact = vendedorList.find(v => v.nome === norm);
    if (exact) return exact.id;
    const partial = vendedorList.find(v => v.nome.includes(norm) || norm.includes(v.nome));
    if (partial) return partial.id;
    const firstName = norm.split(' ')[0];
    if (firstName.length > 3) {
        const byFirst = vendedorList.find(v => v.nome.startsWith(firstName));
        if (byFirst) return byFirst.id;
    }
    return '';
}

function buildClienteData(row, lookups) {
    const { planoMap, tabelaMap, segmentoMap, redeMap, rotaMap, vendedorList, modalidadeMap } = lookups;
    const vendedor_id = findVendedorId(row.vendedor, vendedorList);
    const v = vendedorList.find(x => x.id === vendedor_id);

    return {
        codigo: String(row.codigo).trim(),
        razao_social: row.razao_social || '',
        nome_fantasia: row.nome_fantasia || '',
        cpf_cnpj: (row.cpf_cnpj || '').replace(/[.\-\/]/g, ''),
        inscricao_estadual: row.inscricao_estadual || '',
        endereco: row.endereco || '',
        numero: row.numero || '',
        bairro: row.bairro || '',
        cidade: row.cidade || '',
        estado: row.estado || 'PE',
        cep: (row.cep || '').replace(/\D/g, ''),
        latitude: parseLat(row.latitude),
        longitude: parseLng(row.longitude),
        status: (row.status || '').toLowerCase() === 'ativo' ? 'ativo' : 'inativo',
        email: 'nfe@paoemel.com.br',
        plano_pagamento_id: findPlanoId(row.plano_pagamento, planoMap),
        tabela_id: findTabelaId(row.tabela_preco, tabelaMap),
        segmento_id: segmentoMap[normalizeStr(row.segmento)] || '',
        rede_id: redeMap[normalizeStr(row.rede)] || '',
        rota_id: findRotaId(row.rota, rotaMap),
        vendedor_id,
        supervisor_id: v?.supervisor_id || '',
        modalidade_pagamento_id: modalidadeMap[normalizeStr(normalizeCobranca(row.COBRANA))] || modalidadeMap['PIX'] || '',
    };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { csv_url, etapa, offset = 0, batch_size = 50 } = body;
        // etapa: 'analise', 'atualizar', 'excluir'

        if (!csv_url) return Response.json({ error: 'csv_url obrigatório' }, { status: 400 });

        // Baixar CSV
        const csvResp = await fetch(csv_url);
        const csvText = await csvResp.text();
        const csvRows = parseCSV(csvText);

        // Lookups
        const [planos, tabelas, segmentos, redes, rotas, vendedores, modalidades] = await Promise.all([
            base44.asServiceRole.entities.PlanoPagamento.list(),
            base44.asServiceRole.entities.TabelaPreco.list(),
            base44.asServiceRole.entities.Segmento.list(),
            base44.asServiceRole.entities.Rede.list(),
            base44.asServiceRole.entities.Rota.list(),
            base44.asServiceRole.entities.Vendedor.list(),
            base44.asServiceRole.entities.ModalidadePagamento.list(),
        ]);
        const lookups = buildLookups(planos, tabelas, segmentos, redes, rotas, vendedores, modalidades);

        // Clientes do sistema
        const clientesSistema = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
        const sistemaMap = {};
        clientesSistema.forEach(c => { sistemaMap[c.codigo] = c; });
        const csvCodigos = new Set(csvRows.map(r => String(r.codigo).trim()));

        // === ANÁLISE ===
        if (etapa === 'analise' || !etapa) {
            const criar = csvRows.filter(r => !sistemaMap[String(r.codigo).trim()]);
            const excluir = clientesSistema.filter(c => !csvCodigos.has(c.codigo));

            // Comparar campo a campo para encontrar apenas os que realmente mudaram
            const camposComparar = [
                'razao_social', 'nome_fantasia', 'cpf_cnpj', 'inscricao_estadual',
                'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep',
                'status', 'plano_pagamento_id', 'tabela_id', 'segmento_id',
                'rede_id', 'rota_id', 'vendedor_id', 'supervisor_id', 'modalidade_pagamento_id',
            ];
            const atualizar = [];
            for (const row of csvRows) {
                const cod = String(row.codigo).trim();
                const existente = sistemaMap[cod];
                if (!existente) continue;
                const novo = buildClienteData(row, lookups);
                let diferente = false;
                for (const campo of camposComparar) {
                    const valNovo = (novo[campo] || '').toString().trim();
                    const valExistente = (existente[campo] || '').toString().trim();
                    if (valNovo !== valExistente) {
                        diferente = true;
                        break;
                    }
                }
                if (diferente) atualizar.push(row);
            }

            return Response.json({
                sucesso: true, etapa: 'analise',
                csv_total: csvRows.length, sistema_total: clientesSistema.length,
                atualizar: atualizar.length, criar: criar.length, excluir: excluir.length,
                excluir_preview: excluir.slice(0, 20).map(e => `${e.codigo} - ${e.razao_social}`),
            });
        }

        // === ATUALIZAR (em lotes com bulkUpdate — até 500 por chamada) ===
        if (etapa === 'atualizar') {
            const camposComparar = [
                'razao_social', 'nome_fantasia', 'cpf_cnpj', 'inscricao_estadual',
                'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep',
                'status', 'plano_pagamento_id', 'tabela_id', 'segmento_id',
                'rede_id', 'rota_id', 'vendedor_id', 'supervisor_id', 'modalidade_pagamento_id',
            ];
            const paraAtualizar = [];
            for (const r of csvRows) {
                const cod = String(r.codigo).trim();
                const existente = sistemaMap[cod];
                if (!existente) continue;
                const novo = buildClienteData(r, lookups);
                let diferente = false;
                for (const campo of camposComparar) {
                    const valNovo = (novo[campo] || '').toString().trim();
                    const valExistente = (existente[campo] || '').toString().trim();
                    if (valNovo !== valExistente) {
                        diferente = true;
                        break;
                    }
                }
                if (diferente) {
                    paraAtualizar.push({ id: existente.id, ...novo });
                }
            }

            // bulkUpdate aceita até 500 por chamada, usamos batch_size do request
            const bulkSize = Math.min(batch_size, 500);
            const lote = paraAtualizar.slice(offset, offset + bulkSize);
            let ok = 0, erros = 0;
            const errosList = [];

            if (lote.length > 0) {
                let success = false;
                for (let attempt = 0; attempt < 4 && !success; attempt++) {
                    try {
                        await base44.asServiceRole.entities.Cliente.bulkUpdate(lote);
                        ok = lote.length;
                        success = true;
                    } catch (e) {
                        if (e.message?.includes('Rate limit') && attempt < 3) {
                            console.log(`[sincronizarCSV] Rate limit no bulkUpdate, tentativa ${attempt + 1}, aguardando ${5000 * (attempt + 1)}ms`);
                            await delay(5000 * (attempt + 1));
                        } else {
                            console.error(`[sincronizarCSV] Erro bulkUpdate: ${e.message}`);
                            erros = lote.length;
                            errosList.push(`Lote ${offset}-${offset + lote.length}: ${e.message}`);
                        }
                    }
                }
            }

            const nextOffset = offset + bulkSize;
            const temMais = nextOffset < paraAtualizar.length;

            return Response.json({
                sucesso: true, etapa: 'atualizar',
                total: paraAtualizar.length, processados: ok, erros,
                offset, nextOffset: temMais ? nextOffset : null,
                concluido: !temMais,
                erros_detalhes: errosList,
            });
        }

        // === EXCLUIR (sequencial no Omie com retry, paralelo no Base44) ===
        if (etapa === 'excluir') {
            const paraExcluir = clientesSistema.filter(c => !csvCodigos.has(c.codigo));
            const bulkSize = Math.min(batch_size, 100);
            const lote = paraExcluir.slice(offset, offset + bulkSize);
            let ok = 0, erros = 0;
            const errosList = [];
            const idsParaExcluirBase44 = [];
            const falharam = []; // guardar para retry

            // Fase 1: Excluir do Omie — 1 por vez com delay de 600ms
            for (const item of lote) {
                const res = await tentarExcluirOmie(item);
                if (res.sucesso) {
                    idsParaExcluirBase44.push(item.id);
                } else if (res.rateLimited) {
                    falharam.push(item); // vai pra retry
                } else {
                    // Erro real (dependências, etc) — não faz retry
                    erros++;
                    errosList.push(`${item.codigo} - ${item.razao_social || item.nome_fantasia || 'S/N'}: ${res.msg}`);
                    // Se for erro de dependências, exclui só do Base44 mesmo
                    if (res.msg?.includes('dependem') || res.msg?.includes('informações que dependem')) {
                        // Não excluir do Base44 se tem dependências no Omie
                    } else if (res.msg?.includes('não encontrado') || res.msg?.includes('não cadastrado')) {
                        idsParaExcluirBase44.push(item.id); // já não existe no Omie, pode deletar do Base44
                    }
                }
                await delay(600);
            }

            // Fase 2: Retry dos que falharam por rate limit (espera 8s e tenta de novo)
            if (falharam.length > 0) {
                console.log(`[sincronizarCSV] Retry de ${falharam.length} exclusões que deram rate limit...`);
                await delay(8000);
                for (const item of falharam) {
                    const res = await tentarExcluirOmie(item);
                    if (res.sucesso) {
                        idsParaExcluirBase44.push(item.id);
                    } else if (res.rateLimited) {
                        // Segundo rate limit — ainda falhou, reportar erro
                        erros++;
                        errosList.push(`${item.codigo} - ${item.razao_social || item.nome_fantasia || 'S/N'}: Rate limit persistente (tente novamente)`);
                    } else {
                        erros++;
                        errosList.push(`${item.codigo} - ${item.razao_social || item.nome_fantasia || 'S/N'}: ${res.msg}`);
                        if (res.msg?.includes('não encontrado') || res.msg?.includes('não cadastrado')) {
                            idsParaExcluirBase44.push(item.id);
                        }
                    }
                    await delay(800);
                }
            }

            // Fase 3: Excluir do Base44 em paralelo (10 simultâneos)
            for (let i = 0; i < idsParaExcluirBase44.length; i += 10) {
                const chunk = idsParaExcluirBase44.slice(i, i + 10);
                const results = await Promise.allSettled(
                    chunk.map(id => base44.asServiceRole.entities.Cliente.delete(id))
                );
                for (let j = 0; j < results.length; j++) {
                    if (results[j].status === 'fulfilled') {
                        ok++;
                    } else {
                        await delay(2000);
                        try {
                            await base44.asServiceRole.entities.Cliente.delete(chunk[j]);
                            ok++;
                        } catch (e2) {
                            erros++;
                            errosList.push(`Delete Base44 ${chunk[j]}: ${e2.message}`);
                        }
                    }
                }
            }

            const nextOffset = offset + bulkSize;
            const temMais = nextOffset < paraExcluir.length;

            return Response.json({
                sucesso: true, etapa: 'excluir',
                total: paraExcluir.length, processados: ok, erros,
                offset, nextOffset: temMais ? nextOffset : null,
                concluido: !temMais,
                erros_detalhes: errosList,
            });
        }

        // === CRIAR (novos clientes que estão no CSV mas não no sistema) ===
        if (etapa === 'criar') {
            const paraCriar = csvRows
                .filter(r => !sistemaMap[String(r.codigo).trim()])
                .map(r => buildClienteData(r, lookups));

            const bulkSize = Math.min(batch_size, 500);
            const lote = paraCriar.slice(offset, offset + bulkSize);
            let ok = 0, erros = 0;
            const errosList = [];

            if (lote.length > 0) {
                let success = false;
                for (let attempt = 0; attempt < 4 && !success; attempt++) {
                    try {
                        await base44.asServiceRole.entities.Cliente.bulkCreate(lote);
                        ok = lote.length;
                        success = true;
                    } catch (e) {
                        if (e.message?.includes('Rate limit') && attempt < 3) {
                            console.log(`[sincronizarCSV] Rate limit no bulkCreate, tentativa ${attempt + 1}, aguardando ${5000 * (attempt + 1)}ms`);
                            await delay(5000 * (attempt + 1));
                        } else {
                            console.error(`[sincronizarCSV] Erro bulkCreate: ${e.message}`);
                            erros = lote.length;
                            errosList.push(`Lote ${offset}-${offset + lote.length}: ${e.message}`);
                        }
                    }
                }
            }

            const nextOffset = offset + bulkSize;
            const temMais = nextOffset < paraCriar.length;

            return Response.json({
                sucesso: true, etapa: 'criar',
                total: paraCriar.length, processados: ok, erros,
                offset, nextOffset: temMais ? nextOffset : null,
                concluido: !temMais,
                erros_detalhes: errosList,
            });
        }

        return Response.json({ error: 'etapa inválida (analise/atualizar/criar/excluir)' }, { status: 400 });

    } catch (error) {
        console.error('[sincronizarClientesCSV] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});