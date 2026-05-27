import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ============================================================================
// REVINCULAR REFERÊNCIAS (Tabela Preço, Plano Pagamento, Modalidade Pagamento)
// Lê o CSV e força a atualização dos campos de referência em TODOS os clientes,
// mesmo que o valor atual seja null ou igual. Isso corrige clientes cujas
// referências foram perdidas quando as tabelas foram recriadas com novos IDs.
//
// Etapas:
//   analise    → Conta quantos clientes serão atualizados e mostra preview
//   executar   → Atualiza em lotes com offset/batch_size
// ============================================================================

const HEADER_MAP = {
    'CODIGO': 'codigo', 'RAZAO_SOCIAL': 'razao_social', 'FANTASIA': 'nome_fantasia',
    'CPF_CNPJ': 'cpf_cnpj', 'COBRANCA': 'cobranca', 'PLANO PAGAMENTO': 'plano_pagamento',
    'NOME_TABELA': 'tabela_preco', 'STATUS': 'status',
};


function normalizeStr(s) {
    return (s || '').toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
        if (obj.codigo) rows.push(obj);
    }
    return rows;
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
        'BOLETO BANCARIO': 'BOLETO BANCARIO', 'BOELTO BANCARIO': 'BOLETO BANCARIO',
        'PIX': 'PIX', 'DINHEIRO': 'DINHEIRO',
        'PIX A PRAZO': 'PIX A PRAZO', 'TRANSFERENCIA BANCO': 'TRANSFERENCIA',
        'TRANSFERENCIA': 'TRANSFERENCIA',
        'CARTAO DE DEBITO': 'PIX', 'CARTEIRA': 'PIX',
    };
    return map[upper] || upper;
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

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { csv_url, etapa, offset = 0, batch_size = 30, apenas_ativos = false } = body;

        if (!csv_url) return Response.json({ error: 'csv_url obrigatório' }, { status: 400 });

        // Baixar e parsear CSV
        const csvResp = await fetch(csv_url);
        const csvText = await csvResp.text();
        const csvRows = parseCSV(csvText);

        // Carregar lookups
        const [planos, tabelas, modalidades] = await Promise.all([
            base44.asServiceRole.entities.PlanoPagamento.list(),
            base44.asServiceRole.entities.TabelaPreco.list(),
            base44.asServiceRole.entities.ModalidadePagamento.list(),
        ]);

        const planoMap = {};
        planos.forEach(p => { planoMap[normalizeStr(p.nome)] = p.id; });
        
        const tabelaMap = {};
        tabelas.forEach(t => { tabelaMap[normalizeStr(t.nome)] = t.id; });
        
        const modalidadeMap = {};
        modalidades.forEach(m => { modalidadeMap[normalizeStr(m.nome)] = m.id; });

        // Carregar clientes do Base44
        let clientesSistema = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
        if (apenas_ativos) {
            clientesSistema = clientesSistema.filter(c => c.status === 'ativo');
        }
        const sistemaMap = {};
        clientesSistema.forEach(c => { if (c.codigo) sistemaMap[c.codigo] = c; });

        // Para cada CSV row, resolver as referências
        const atualizacoes = [];
        const nomesNaoEncontrados = { tabelas: new Set(), planos: new Set(), modalidades: new Set() };

        for (const row of csvRows) {
            const cod = String(row.codigo).trim();
            const existente = sistemaMap[cod];
            if (!existente) continue;

            const planoNorm = normalizePlano(row.plano_pagamento);
            const cobrancaNorm = normalizeCobranca(row.cobranca);
            const tabelaNorm = normalizeStr(row.tabela_preco);

            const novoTabelaId = tabelaNorm ? findInMap(row.tabela_preco, tabelaMap) : '';
            const novoPlanoId = planoNorm ? (planoMap[normalizeStr(planoNorm)] || '') : '';
            const novoModalidadeId = cobrancaNorm ? (modalidadeMap[normalizeStr(cobrancaNorm)] || '') : '';

            // Verificar se precisa atualizar (campos diferentes do atual)
            const mudouTabela = (novoTabelaId || '') !== (existente.tabela_id || '');
            const mudouPlano = (novoPlanoId || '') !== (existente.plano_pagamento_id || '');
            const mudouModalidade = (novoModalidadeId || '') !== (existente.modalidade_pagamento_id || '');

            // Rastrear nomes não resolvidos
            if (tabelaNorm && !novoTabelaId) nomesNaoEncontrados.tabelas.add(row.tabela_preco);
            if (planoNorm && !novoPlanoId) nomesNaoEncontrados.planos.add(row.plano_pagamento);
            if (cobrancaNorm && !novoModalidadeId) nomesNaoEncontrados.modalidades.add(row.cobranca);

            if (mudouTabela || mudouPlano || mudouModalidade) {
                const tabelaNome = tabelas.find(t => t.id === novoTabelaId)?.nome || '';
                const planoNome = planos.find(p => p.id === novoPlanoId)?.nome || '';
                const modalidadeNome = modalidades.find(m => m.id === novoModalidadeId)?.nome || '';

                atualizacoes.push({
                    id: existente.id,
                    codigo: cod,
                    nome: existente.razao_social || existente.nome_fantasia || '',
                    tabela_id: novoTabelaId,
                    plano_pagamento_id: novoPlanoId,
                    modalidade_pagamento_id: novoModalidadeId,
                    // Para preview
                    csv_tabela: row.tabela_preco || '(vazio)',
                    csv_plano: row.plano_pagamento || '(vazio)',
                    csv_cobranca: row.cobranca || '(vazio)',
                    resolvido_tabela: tabelaNome || '⚠️ NÃO ENCONTRADA',
                    resolvido_plano: planoNome || '⚠️ NÃO ENCONTRADO',
                    resolvido_modalidade: modalidadeNome || '⚠️ NÃO ENCONTRADA',
                    mudou_tabela: mudouTabela,
                    mudou_plano: mudouPlano,
                    mudou_modalidade: mudouModalidade,
                });
            }
        }

        // ===== ANÁLISE =====
        if (etapa === 'analise') {
            // Clientes sem referência - com detalhes
            const semTabelaList = clientesSistema.filter(c => !c.tabela_id);
            const semPlanoList = clientesSistema.filter(c => !c.plano_pagamento_id);
            const semModalidadeList = clientesSistema.filter(c => !c.modalidade_pagamento_id);
            const semTabela = semTabelaList.length;
            const semPlano = semPlanoList.length;
            const semModalidade = semModalidadeList.length;
            const mapCliente = (c) => ({ codigo: c.codigo, nome: c.razao_social || c.nome_fantasia || '' });

            return Response.json({
                sucesso: true,
                total_csv: csvRows.length,
                total_sistema: clientesSistema.length,
                total_atualizar: atualizacoes.length,
                sem_tabela: semTabela,
                sem_plano: semPlano,
                sem_modalidade: semModalidade,
                clientes_sem_tabela: semTabelaList.map(mapCliente),
                clientes_sem_plano: semPlanoList.map(mapCliente),
                clientes_sem_modalidade: semModalidadeList.map(mapCliente),
                preview: atualizacoes.slice(0, 50),
                // Nomes não resolvidos (detalhados)
                tabela_nao_resolvida: nomesNaoEncontrados.tabelas.size,
                plano_nao_resolvido: nomesNaoEncontrados.planos.size,
                modalidade_nao_resolvida: nomesNaoEncontrados.modalidades.size,
                nomes_tabela_nao_resolvida: [...nomesNaoEncontrados.tabelas],
                nomes_plano_nao_resolvido: [...nomesNaoEncontrados.planos],
                nomes_modalidade_nao_resolvida: [...nomesNaoEncontrados.modalidades],
            });
        }

        // ===== EXECUTAR =====
        if (etapa === 'executar') {
            const bulkSize = Math.min(batch_size, 30);
            const lote = atualizacoes.slice(offset, offset + bulkSize);
            let ok = 0, erros = 0;
            const errosList = [];

            for (const item of lote) {
                let atualizado = false;
                for (let attempt = 0; attempt < 4; attempt++) {
                    try {
                        await base44.asServiceRole.entities.Cliente.update(item.id, {
                            tabela_id: item.tabela_id,
                            plano_pagamento_id: item.plano_pagamento_id,
                            modalidade_pagamento_id: item.modalidade_pagamento_id,
                        });
                        ok++;
                        atualizado = true;
                        break;
                    } catch (e) {
                        const isRateLimit = e.message?.includes('Rate limit') || e.message?.includes('429');
                        if (isRateLimit && attempt < 3) {
                            continue;
                        }
                        break;
                    }
                }
                if (!atualizado) {
                    erros++;
                    errosList.push(`${item.codigo} - ${item.nome}: falha ao atualizar`);
                }
            }

            const nextOffset = offset + bulkSize;
            return Response.json({
                sucesso: true,
                total: atualizacoes.length,
                processados: ok,
                erros,
                offset,
                nextOffset: nextOffset < atualizacoes.length ? nextOffset : null,
                concluido: nextOffset >= atualizacoes.length,
                erros_detalhes: errosList,
            });
        }

        return Response.json({ error: 'etapa inválida (analise/executar)' }, { status: 400 });

    } catch (error) {
        const isRateLimit = error.message?.includes('Rate limit') || error.message?.includes('429');
        if (isRateLimit) {
            return Response.json({ error: 'Rate limit - tente novamente' }, { status: 429 });
        }
        console.error('[revincularReferenciasCSV] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});