import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import * as XLSX from 'npm:xlsx@0.18.5';

// ============================================================================
// SINCRONIZAR CLIENTES CSV → BASE44 → OMIE
// Função principal e definitiva para sincronização completa.
// CSV é a fonte da verdade. Base44 é o espelho. Omie recebe via UpsertCliente.
//
// Etapas:
//   analise   → Compara CSV × Base44, retorna contagens reais de ação
//   atualizar → Atualiza clientes diferentes no Base44 (bulkUpdate em lotes)
//   criar     → Cria clientes novos no Base44 (bulkCreate em lotes)
//   excluir   → Exclui do Omie e do Base44 clientes que não estão no CSV
//   enviar_omie → Envia um lote de clientes do Base44 para o Omie via UpsertCliente
// ============================================================================

const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

// === MAPEAMENTOS ===

const HEADER_MAP = {
    'CODIGO': 'codigo', 'COD': 'codigo', 'CÓDIGO': 'codigo',
    'RAZAO_SOCIAL': 'razao_social', 'RAZÃO SOCIAL': 'razao_social', 'RAZAO SOCIAL': 'razao_social', 'NOME': 'razao_social',
    'FANTASIA': 'nome_fantasia', 'NOME FANTASIA': 'nome_fantasia', 'NOME_FANTASIA': 'nome_fantasia',
    'CPF_CNPJ': 'cpf_cnpj', 'CNPJ': 'cpf_cnpj', 'CPF': 'cpf_cnpj', 'CPF/CNPJ': 'cpf_cnpj', 'CNPJ/CPF': 'cpf_cnpj', 'CNPJ_CPF': 'cpf_cnpj',
    'IE': 'inscricao_estadual', 'INSCRICAO_ESTADUAL': 'inscricao_estadual', 'INSCRIÇÃO ESTADUAL': 'inscricao_estadual',
    'ENDERECO': 'endereco', 'ENDEREÇO': 'endereco', 'LOGRADOURO': 'endereco',
    'BAIRRO': 'bairro',
    'NUMERO': 'numero', 'NÚMERO': 'numero', 'NUM': 'numero',
    'CEP': 'cep',
    'CIDADE': 'cidade', 'MUNICIPIO': 'cidade', 'MUNICÍPIO': 'cidade',
    'UF': 'estado', 'ESTADO': 'estado', 'SIGLA': 'estado',
    'LATITUDE': 'latitude', 'LAT': 'latitude',
    'LONGITUDE': 'longitude', 'LNG': 'longitude', 'LON': 'longitude',
    'COBRANCA': 'cobranca', 'COBRANÇA': 'cobranca', 'MODALIDADE': 'cobranca',
    'PLANO PAGAMENTO': 'plano_pagamento', 'PLANO_PAGAMENTO': 'plano_pagamento', 'PLANO': 'plano_pagamento',
    'VENDEDOR': 'vendedor',
    'NOME_TABELA': 'tabela_preco', 'TABELA': 'tabela_preco', 'TABELA_PRECO': 'tabela_preco', 'TABELA DE PREÇO': 'tabela_preco',
    'NOME_ROTA': 'rota', 'ROTA': 'rota',
    'STATUS': 'status', 'SITUACAO': 'status', 'SITUAÇÃO': 'status',
    'SEGUIMENTO': 'segmento', 'SEGMENTO': 'segmento',
    'REDE': 'rede',
};

const UF_MAP = {
    'ACRE': 'AC', 'ALAGOAS': 'AL', 'AMAPA': 'AP', 'AMAZONAS': 'AM',
    'BAHIA': 'BA', 'CEARA': 'CE', 'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES',
    'GOIAS': 'GO', 'MARANHAO': 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS',
    'MINAS GERAIS': 'MG', 'PARA': 'PA', 'PARAIBA': 'PB', 'PARANA': 'PR',
    'PERNAMBUCO': 'PE', 'PIAUI': 'PI', 'RIO DE JANEIRO': 'RJ', 'RIO GRANDE DO NORTE': 'RN',
    'RIO GRANDE DO SUL': 'RS', 'RONDONIA': 'RO', 'RORAIMA': 'RR', 'SANTA CATARINA': 'SC',
    'SAO PAULO': 'SP', 'SERGIPE': 'SE', 'TOCANTINS': 'TO',
};

// === UTILITÁRIOS ===

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function normalizeStr(s) {
    return (s || '').toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function estadoParaSigla(val) {
    if (!val) return '';
    const upper = normalizeStr(val);
    if (upper.length === 2) return upper;
    return UF_MAP[upper] || val.trim();
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const rawHeader = lines[0].split(';').map(h => h.trim());
    const header = rawHeader.map(h => HEADER_MAP[h.toUpperCase().trim()] || h.toLowerCase().replace(/\s+/g, '_'));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(';');
        const obj = {};
        header.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
        if (obj.codigo || obj.cpf_cnpj) rows.push(obj);
    }
    return rows;
}

function parseXLSX(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return raw.map(row => {
        const obj = {};
        for (const [key, val] of Object.entries(row)) {
            const upper = key.toUpperCase().trim();
            const mapped = HEADER_MAP[upper] || key.toLowerCase().replace(/\s+/g, '_');
            obj[mapped] = val !== null && val !== undefined ? String(val).trim() : '';
        }
        return obj;
    }).filter(r => r.cpf_cnpj || r.razao_social);
}

function parseLat(raw) {
    if (!raw || raw === '0') return 0;
    const num = parseFloat(raw.replace(/\./g, ''));
    return isNaN(num) ? 0 : num / 100000000;
}

function parseLng(raw) {
    if (!raw || raw === '0') return 0;
    const num = parseFloat(raw.replace(/\./g, ''));
    return isNaN(num) ? 0 : num / 100000000;
}

function normalizePlano(v) {
    if (!v || v === '0') return '';
    const upper = v.toUpperCase().trim();
    return upper === 'A VISTA' ? 'AVISTA' : upper;
}

function normalizeCobranca(v) {
    if (!v || v === '0') return '';
    const upper = v.toUpperCase().trim();
    const map = {
        'BOLETO BANCARIO': 'BOELTO BANCARIO', 'PIX': 'PIX', 'DINHEIRO': 'DINHEIRO',
        'PIX A PRAZO': 'PIX A PRAZO', 'TRANSFERENCIA BANCO': 'TRANSFERENCIA',
        'CARTAO DE DEBITO': 'PIX', 'CARTEIRA': 'PIX',
    };
    return map[upper] || upper;
}

// === LOOKUPS ===

function buildLookups(planos, tabelas, segmentos, redes, rotas, vendedores, modalidades) {
    const mapBy = (arr) => { const m = {}; arr.forEach(x => { m[normalizeStr(x.nome)] = x.id; }); return m; };
    return {
        planoMap: mapBy(planos),
        tabelaMap: mapBy(tabelas),
        segmentoMap: mapBy(segmentos),
        redeMap: mapBy(redes),
        rotaMap: mapBy(rotas),
        vendedorList: vendedores.map(v => ({ id: v.id, nome: normalizeStr(v.nome), supervisor_id: v.supervisor_id })),
        modalidadeMap: mapBy(modalidades),
    };
}

function findInMap(val, map) {
    const norm = normalizeStr(val);
    if (!norm) return '';
    if (map[norm]) return map[norm];
    for (const [key, id] of Object.entries(map)) {
        if (key.includes(norm) || norm.includes(key)) return id;
    }
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

function findRotaId(csvVal, rotaMap) {
    const norm = normalizeStr(csvVal);
    if (!norm) return '';
    if (rotaMap[norm]) return rotaMap[norm];
    for (const [key, id] of Object.entries(rotaMap)) {
        if (key.replace(/\s+/g, ' ').includes(norm.replace(/\s+/g, ' ')) || norm.replace(/\s+/g, ' ').includes(key.replace(/\s+/g, ' '))) return id;
    }
    if (norm.includes('DELIVERY')) return rotaMap[normalizeStr('RETIRADA')] || '';
    if (norm.includes('APLICATIVO')) return rotaMap[normalizeStr('APLICATIVO B2B')] || '';
    return '';
}

function buildClienteData(row, lookups) {
    const { planoMap, tabelaMap, segmentoMap, redeMap, rotaMap, vendedorList, modalidadeMap } = lookups;
    const vendedor_id = findVendedorId(row.vendedor, vendedorList);
    const v = vendedorList.find(x => x.id === vendedor_id);
    const planoNorm = normalizePlano(row.plano_pagamento);
    const cobrancaNorm = normalizeCobranca(row.cobranca);
    const redeNorm = normalizeStr(row.rede);

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
        estado: estadoParaSigla(row.estado),
        cep: (row.cep || '').replace(/\D/g, ''),
        latitude: parseLat(row.latitude),
        longitude: parseLng(row.longitude),
        status: (row.status || '').toLowerCase() === 'ativo' ? 'ativo' : 'inativo',
        email: 'nfe@paoemel.com.br',
        plano_pagamento_id: planoNorm ? (planoMap[normalizeStr(planoNorm)] || '') : '',
        tabela_id: findInMap(row.tabela_preco, tabelaMap),
        segmento_id: segmentoMap[normalizeStr(row.segmento)] || '',
        rede_id: redeNorm ? (redeMap[redeNorm] || '') : (redeMap[normalizeStr('SEM REDE')] || redeMap['(SEM REDE)'] || ''),
        rota_id: findRotaId(row.rota, rotaMap),
        vendedor_id,
        supervisor_id: v?.supervisor_id || '',
        modalidade_pagamento_id: cobrancaNorm ? (modalidadeMap[normalizeStr(cobrancaNorm)] || '') : '',
    };
}

// === OMIE ===

async function chamarOmieComRetry(callName, param, maxRetries = 2) {
    const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
    const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
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

// Campos que determinam se um cliente precisa ser atualizado
const CAMPOS_COMPARAR = [
    'razao_social', 'nome_fantasia', 'cpf_cnpj', 'inscricao_estadual',
    'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep',
    'status', 'plano_pagamento_id', 'tabela_id', 'segmento_id',
    'rede_id', 'rota_id', 'vendedor_id', 'supervisor_id', 'modalidade_pagamento_id',
];

function clienteDiferente(novo, existente) {
    for (const campo of CAMPOS_COMPARAR) {
        if ((novo[campo] || '').toString().trim() !== (existente[campo] || '').toString().trim()) {
            return true;
        }
    }
    return false;
}

// === HANDLER PRINCIPAL ===

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { csv_url, etapa, offset = 0, batch_size = 50 } = body;

        if (!csv_url) return Response.json({ error: 'csv_url obrigatório' }, { status: 400 });

        // Baixar arquivo (CSV ou XLSX)
        const fileResp = await fetch(csv_url);
        const contentType = fileResp.headers.get('content-type') || '';
        const isXlsx = csv_url.toLowerCase().includes('.xlsx') || csv_url.toLowerCase().includes('.xls')
            || contentType.includes('spreadsheet') || contentType.includes('excel') || contentType.includes('openxml');
        let csvRows;
        if (isXlsx) {
            console.log('[debug] Detectado como XLSX, content-type:', contentType);
            const buffer = await fileResp.arrayBuffer();
            csvRows = parseXLSX(new Uint8Array(buffer));
        } else {
            console.log('[debug] Detectado como CSV, content-type:', contentType);
            const csvText = await fileResp.text();
            csvRows = parseCSV(csvText);
        }
        console.log('[debug] Total linhas parseadas:', csvRows.length, '| Primeira linha:', csvRows[0] ? JSON.stringify(csvRows[0]).substring(0, 200) : 'VAZIO');

        // Carregar lookups sequencialmente para evitar rate limit
        const planos = await base44.asServiceRole.entities.PlanoPagamento.list();
        const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
        const segmentos = await base44.asServiceRole.entities.Segmento.list();
        const redes = await base44.asServiceRole.entities.Rede.list();
        await delay(300);
        const rotas = await base44.asServiceRole.entities.Rota.list();
        const vendedores = await base44.asServiceRole.entities.Vendedor.list();
        const modalidades = await base44.asServiceRole.entities.ModalidadePagamento.list();
        const lookups = buildLookups(planos, tabelas, segmentos, redes, rotas, vendedores, modalidades);

        // Carregar clientes do Base44
        await delay(500);
        const clientesSistema = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);

        // Detecta se o CSV usa CNPJ como chave (todos os códigos são "0" ou vazios)
        const codigosValidos = csvRows.filter(r => r.codigo && String(r.codigo).trim() !== '0' && String(r.codigo).trim() !== '');
        const usarCnpjComoChave = codigosValidos.length < csvRows.length * 0.5;
        console.log(`[debug] codigosValidos: ${codigosValidos.length}/${csvRows.length} → usarCnpjComoChave: ${usarCnpjComoChave}`);

        const sistemaMap = {}; // por código
        const sistemaMapCnpj = {}; // por CNPJ
        clientesSistema.forEach(c => {
            if (c.codigo) sistemaMap[c.codigo] = c;
            const cnpj = (c.cnpj_cpf || '').replace(/\D/g, '');
            if (cnpj) sistemaMapCnpj[cnpj] = c;
        });

        const csvCodigos = new Set(csvRows.map(r => String(r.codigo).trim()));
        const csvCnpjs = new Set(csvRows.map(r => (r.cpf_cnpj || '').replace(/\D/g, '')).filter(Boolean));
        console.log(`[debug] sistemaMapCnpj keys: ${Object.keys(sistemaMapCnpj).length}, csvCnpjs: ${csvCnpjs.size}`);
        // Amostra de 3 CNPJs do CSV vs sistemaMap para diagnóstico
        const amostras = [...csvCnpjs].slice(0, 3);
        amostras.forEach(cnpj => console.log(`[debug] CSV cnpj "${cnpj}" → no sistema: ${!!sistemaMapCnpj[cnpj]}`));

        const buscarNaSistema = (row) => {
            if (!usarCnpjComoChave && row.codigo && String(row.codigo).trim() !== '0') {
                return sistemaMap[String(row.codigo).trim()] || null;
            }
            const cnpj = (row.cpf_cnpj || '').replace(/\D/g, '');
            return cnpj ? (sistemaMapCnpj[cnpj] || null) : null;
        };

        // =====================================================================
        // ANÁLISE — retorna contagens reais de operações necessárias
        // =====================================================================
        if (etapa === 'analise' || !etapa) {
            const criar = csvRows.filter(r => !buscarNaSistema(r));
            const excluir = clientesSistema.filter(c => {
                const cnpj = (c.cnpj_cpf || '').replace(/\D/g, '');
                return usarCnpjComoChave
                    ? (cnpj ? !csvCnpjs.has(cnpj) : true)
                    : (c.codigo ? !csvCodigos.has(c.codigo) : false);
            });

            const atualizar = [];
            for (const row of csvRows) {
                const existente = buscarNaSistema(row);
                if (!existente) continue;
                const novo = buildClienteData(row, lookups);
                if (clienteDiferente(novo, existente)) atualizar.push(row);
            }

            return Response.json({
                sucesso: true, etapa: 'analise',
                csv_total: csvRows.length, sistema_total: clientesSistema.length,
                atualizar: atualizar.length, criar: criar.length, excluir: excluir.length,
                excluir_preview: excluir.slice(0, 20).map(e => `${e.codigo} - ${e.razao_social}`),
                excluir_ids: excluir.map(e => ({
                    id: e.id, codigo: e.codigo,
                    nome: e.razao_social || e.nome_fantasia || '',
                    razao_social: e.razao_social || e.nome_fantasia || 'Cliente',
                    cpf_cnpj: e.cpf_cnpj || ''
                })),
            });
        }

        // =====================================================================
        // ATUALIZAR — individual com retry robusto (lotes menores)
        // =====================================================================
        if (etapa === 'atualizar') {
            const paraAtualizar = [];
            for (const r of csvRows) {
                const existente = buscarNaSistema(r);
                if (!existente) continue;
                const novo = buildClienteData(r, lookups);
                if (clienteDiferente(novo, existente)) {
                    paraAtualizar.push({ id: existente.id, ...novo });
                }
            }

            const bulkSize = Math.min(batch_size, 30);
            const lote = paraAtualizar.slice(offset, offset + bulkSize);
            let ok = 0, erros = 0;
            const errosList = [];

            // Processar individualmente com retry para máxima confiabilidade
            for (const item of lote) {
                let atualizado = false;
                for (let attempt = 0; attempt < 5; attempt++) {
                    try {
                        const { id, ...data } = item;
                        await base44.asServiceRole.entities.Cliente.update(id, data);
                        ok++;
                        atualizado = true;
                        await delay(200);
                        break;
                    } catch (e) {
                        const isRateLimit = e.message?.includes('Rate limit') || e.message?.includes('429');
                        if (isRateLimit && attempt < 4) {
                            const waitMs = 3000 * Math.pow(2, attempt);
                            console.log(`[atualizar] Rate limit ${item.codigo}, tentativa ${attempt + 1}, aguardando ${waitMs}ms`);
                            await delay(waitMs);
                            continue;
                        }
                        break;
                    }
                }
                if (!atualizado) {
                    erros++;
                    errosList.push(`Cliente ${item.codigo || item.id}: falha ao atualizar`);
                }
            }

            const nextOffset = offset + bulkSize;
            return Response.json({
                sucesso: true, etapa: 'atualizar',
                total: paraAtualizar.length, processados: ok, erros,
                offset, nextOffset: nextOffset < paraAtualizar.length ? nextOffset : null,
                concluido: nextOffset >= paraAtualizar.length,
                erros_detalhes: errosList,
            });
        }

        // =====================================================================
        // CRIAR — individual com retry robusto
        // =====================================================================
        if (etapa === 'criar') {
            const paraCriar = csvRows
                .filter(r => !buscarNaSistema(r))
                .map(r => buildClienteData(r, lookups));

            const bulkSize = Math.min(batch_size, 20);
            const lote = paraCriar.slice(offset, offset + bulkSize);
            let ok = 0, erros = 0;
            const errosList = [];

            for (const item of lote) {
                let criado = false;
                for (let attempt = 0; attempt < 5; attempt++) {
                    try {
                        await base44.asServiceRole.entities.Cliente.create(item);
                        ok++;
                        criado = true;
                        await delay(250);
                        break;
                    } catch (e) {
                        const isRateLimit = e.message?.includes('Rate limit') || e.message?.includes('429');
                        if (isRateLimit && attempt < 4) {
                            const waitMs = 3000 * Math.pow(2, attempt);
                            console.log(`[criar] Rate limit ${item.codigo}, tentativa ${attempt + 1}, aguardando ${waitMs}ms`);
                            await delay(waitMs);
                            continue;
                        }
                        break;
                    }
                }
                if (!criado) {
                    erros++;
                    errosList.push(`Cliente ${item.codigo || 'sem código'}: falha ao criar`);
                }
            }

            const nextOffset = offset + bulkSize;
            return Response.json({
                sucesso: true, etapa: 'criar',
                total: paraCriar.length, processados: ok, erros,
                offset, nextOffset: nextOffset < paraCriar.length ? nextOffset : null,
                concluido: nextOffset >= paraCriar.length,
                erros_detalhes: errosList,
            });
        }

        // =====================================================================
        // EXCLUIR — Exclui do Omie via ExcluirCliente, depois do Base44
        // Rate limit: 350ms entre chamadas, retry com backoff exponencial
        // =====================================================================
        if (etapa === 'excluir') {
            const paraExcluir = clientesSistema.filter(c => c.codigo && !csvCodigos.has(c.codigo));
            const bulkSize = Math.min(batch_size, 50);
            const lote = paraExcluir.slice(offset, offset + bulkSize);
            let ok = 0, erros = 0;
            const errosList = [];
            const idsParaExcluirBase44 = [];

            // Fase 1: Excluir do Omie
            for (const item of lote) {
                const resultado = await chamarOmieComRetry("ExcluirCliente", { codigo_cliente_integracao: item.id }, 3);
                const fault = (resultado.faultstring || '').toLowerCase();
                if (!resultado.faultstring || fault.includes('não encontrado') || fault.includes('não cadastrado')) {
                    idsParaExcluirBase44.push(item.id);
                } else {
                    erros++;
                    errosList.push(`${item.codigo} - ${item.razao_social || 'S/N'}: ${resultado.faultstring}`);
                }
                await delay(350);
            }

            // Fase 2: Excluir do Base44 em paralelo (10 por vez)
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
            return Response.json({
                sucesso: true, etapa: 'excluir',
                total: paraExcluir.length, processados: ok, erros,
                offset, nextOffset: nextOffset < paraExcluir.length ? nextOffset : null,
                concluido: nextOffset >= paraExcluir.length,
                erros_detalhes: errosList,
            });
        }

        // =====================================================================
        // ENVIAR OMIE — Envia clientes do Base44 para o Omie via UpsertCliente
        // Recebe: { csv_url, etapa: 'enviar_omie', offset, batch_size }
        // Envia TODOS os clientes que existem no CSV (= estão no Base44 após sync)
        // =====================================================================
        if (etapa === 'enviar_omie') {
            // Recarregar clientes do Base44 (pós-sync)
            const clientesAtuais = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
            // Filtrar apenas os que estão no CSV
            const clientesParaEnviar = clientesAtuais.filter(c => c.codigo && csvCodigos.has(c.codigo));
            
            const bulkSize = Math.min(batch_size, 20); // Omie aceita ~120 req/min, usamos 20 por lote
            const lote = clientesParaEnviar.slice(offset, offset + bulkSize);
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
                const match = (resultado.faultstring || '').match(/Id \[(\d+)\]/i);
                const codigoOmieExistente = match ? Number(match[1]) : null;
                if (resultado.faultstring && codigoOmieExistente) {
                    const associacao = await chamarOmieComRetry("AssociarCodIntCliente", {
                        codigo_cliente_omie: codigoOmieExistente,
                        codigo_cliente_integracao: clienteOmie.codigo_cliente_integracao
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
                    errosList.push(`${c.codigo} - ${c.razao_social}: ${resultado.faultstring}`);
                } else {
                    ok++;
                }
                await delay(250);
            }

            const nextOffset = offset + bulkSize;
            return Response.json({
                sucesso: true, etapa: 'enviar_omie',
                total: clientesParaEnviar.length, processados: ok, erros,
                offset, nextOffset: nextOffset < clientesParaEnviar.length ? nextOffset : null,
                concluido: nextOffset >= clientesParaEnviar.length,
                erros_detalhes: errosList,
            });
        }

        return Response.json({ error: 'etapa inválida (analise/atualizar/criar/excluir/enviar_omie)' }, { status: 400 });

    } catch (error) {
        const isRateLimit = error.message?.includes('Rate limit') || error.message?.includes('429');
        if (isRateLimit) {
            console.warn('[sincronizarClientesCSV] Rate limit global, retornando 429 para retry');
            return Response.json({ error: 'Rate limit - tente novamente em alguns segundos' }, { status: 429 });
        }
        console.error('[sincronizarClientesCSV] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});