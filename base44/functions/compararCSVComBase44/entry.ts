import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Mapeamento de cabeçalhos do CSV para nomes internos
const HEADER_MAP = {
    'CODIGO': 'codigo',
    'RAZAO_SOCIAL': 'razao_social',
    'FANTASIA': 'nome_fantasia',
    'CPF_CNPJ': 'cpf_cnpj',
    'IE': 'inscricao_estadual',
    'ENDERECO': 'endereco',
    'BAIRRO': 'bairro',
    'NUMERO': 'numero',
    'CEP': 'cep',
    'CIDADE': 'cidade',
    'UF': 'estado',
    'LATITUDE': 'latitude',
    'LONGITUDE': 'longitude',
    'COBRANCA': 'cobranca',
    'PLANO PAGAMENTO': 'plano_pagamento',
    'VENDEDOR': 'vendedor',
    'NOME_TABELA': 'tabela_preco',
    'NOME_ROTA': 'rota',
    'STATUS': 'status',
    'SEGUIMENTO': 'segmento',
    'REDE': 'rede',
};

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const rawHeader = lines[0].split(';').map(h => h.trim());
    // Map headers to internal names
    const header = rawHeader.map(h => {
        const upper = h.toUpperCase().trim();
        return HEADER_MAP[upper] || h.toLowerCase().replace(/\s+/g, '_');
    });
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(';');
        const obj = {};
        header.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
        if (obj.codigo) rows.push(obj);
    }
    return rows;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { csv_url, etapa, offset = 0, batch_size = 100 } = await req.json();
        if (!csv_url) return Response.json({ error: 'csv_url obrigatório' }, { status: 400 });

        // Baixar e parsear CSV
        const csvResp = await fetch(csv_url);
        const csvText = await csvResp.text();
        const csvRows = parseCSV(csvText);

        // Buscar todos os clientes do Base44
        const clientesBase44 = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
        const base44Map = {};
        clientesBase44.forEach(c => { if (c.codigo) base44Map[c.codigo] = c; });

        const csvCodigos = new Set(csvRows.map(r => String(r.codigo).trim()));

        if (etapa === 'analise' || !etapa) {
            // Comparar campo a campo
            const naoEncontrados = []; // No CSV mas não no Base44 — precisam ser criados
            const diferentes = []; // Existem mas com dados diferentes
            let iguais = 0;
            const soNoBase44 = []; // No Base44 mas não no CSV

            for (const row of csvRows) {
                const cod = String(row.codigo).trim();
                const existente = base44Map[cod];
                if (!existente) {
                    naoEncontrados.push({
                        codigo: cod,
                        razao_social: row.razao_social || '',
                        nome_fantasia: row.nome_fantasia || '',
                        cpf_cnpj: row.cpf_cnpj || '',
                        status: (row.status || '').toLowerCase(),
                    });
                    continue;
                }

                // Comparar campos principais (headers já mapeados pelo parseCSV)
                const camposComparar = [
                    ['razao_social', row.razao_social, existente.razao_social],
                    ['nome_fantasia', row.nome_fantasia, existente.nome_fantasia],
                    ['cpf_cnpj', (row.cpf_cnpj || '').replace(/[.\-\/]/g, ''), (existente.cpf_cnpj || '').replace(/[.\-\/]/g, '')],
                    ['endereco', row.endereco, existente.endereco],
                    ['numero', row.numero, existente.numero],
                    ['bairro', row.bairro, existente.bairro],
                    ['cidade', row.cidade, existente.cidade],
                    ['estado', row.estado, existente.estado],
                    ['cep', (row.cep || '').replace(/\D/g, ''), (existente.cep || '').replace(/\D/g, '')],
                    ['status', (row.status || '').toLowerCase() === 'ativo' ? 'ativo' : 'inativo', existente.status || 'ativo'],
                ];


                const diffs = [];
                for (const [campo, valCSV, valBase44] of camposComparar) {
                    const a = (valCSV || '').toString().trim().toUpperCase();
                    const b = (valBase44 || '').toString().trim().toUpperCase();
                    if (a !== b) {
                        diffs.push({ campo, csv: valCSV || '', base44: valBase44 || '' });
                    }
                }

                if (diffs.length > 0) {
                    diferentes.push({
                        id: existente.id,
                        codigo: cod,
                        razao_social: row.razao_social,
                        diffs,
                    });
                } else {
                    iguais++;
                }
            }

            // Clientes no Base44 que não estão no CSV
            for (const c of clientesBase44) {
                if (c.codigo && !csvCodigos.has(c.codigo)) {
                    soNoBase44.push({
                        id: c.id,
                        codigo: c.codigo,
                        razao_social: c.razao_social,
                        nome_fantasia: c.nome_fantasia,
                        status: c.status,
                    });
                }
            }

            return Response.json({
                sucesso: true,
                etapa: 'analise',
                csv_total: csvRows.length,
                base44_total: clientesBase44.length,
                iguais,
                diferentes: diferentes.length,
                nao_encontrados: naoEncontrados.length,
                so_no_base44: soNoBase44.length,
                lista_nao_encontrados: naoEncontrados,
                lista_diferentes: diferentes.slice(0, 500),
                lista_so_base44: soNoBase44.slice(0, 500),
            });
        }

        return Response.json({ error: 'etapa inválida' }, { status: 400 });
    } catch (error) {
        console.error('[compararCSVComBase44] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});