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
    // formato: -827.780.510 → -8.2778051
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
    if (!csv_val || csv_val === '0') return 'A VISTA';
    const v = csv_val.toUpperCase().trim();
    // Mapear CSV → sistema
    const map = {
        'A VISTA': 'AVISTA',
        '7 DIAS': '7 DIAS',
        '4 DIAS': '4 DIAS',
        '6 DIAS': '6 DIAS',
        '3 DIAS': '3 DIAS',
        '10 DIAS': '10 DIAS',
        '14 DIAS': '14 DIAS',
        '15 DIAS': '15 DIAS',
        '21 DIAS': '21 DIAS',
        '28 DIAS': '28 DIAS',
        '30 DIAS': '30 DIAS',
        '35 DIAS': '35 DIAS',
        '40 DIAS': '40 DIAS',
        '45 DIAS': '45 DIAS',
    };
    return map[v] || v;
}

function normalizeCobranca(csv_val) {
    if (!csv_val || csv_val === '0') return 'PIX';
    const v = csv_val.toUpperCase().trim();
    const map = {
        'BOLETO BANCARIO': 'BOELTO BANCARIO', // nome no sistema tem esse typo
        'PIX': 'PIX',
        'DINHEIRO': 'DINHEIRO',
        'PIX A PRAZO': 'PIX A PRAZO',
        'TRANSFERENCIA BANCO': 'TRANSFERENCIA',
        'CARTAO DE DEBITO': 'PIX', // mapear para PIX conforme instrução
        'CARTEIRA': 'PIX', // mapear para PIX conforme instrução
    };
    return map[v] || 'PIX';
}

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
                return { sucesso: true, msg: 'Já não existia no Omie' };
            }
            return { sucesso: false, msg: resultado.faultstring };
        }
        return { sucesso: true, msg: 'Excluído do Omie' };
    } catch (e) {
        return { sucesso: false, msg: e.message };
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json();
        const { csv_url, modo } = body; // modo: 'analise' ou 'executar'

        if (!csv_url) {
            return Response.json({ error: 'csv_url é obrigatório' }, { status: 400 });
        }

        console.log(`[sincronizarClientesCSV] Modo: ${modo}, URL: ${csv_url}`);

        // 1. Baixar e parsear CSV
        const csvResp = await fetch(csv_url);
        const csvText = await csvResp.text();
        const csvRows = parseCSV(csvText);
        console.log(`[sincronizarClientesCSV] CSV: ${csvRows.length} linhas`);

        // 2. Buscar todos os lookups
        const [planos, tabelas, segmentos, redes, rotas, vendedores, modalidades] = await Promise.all([
            base44.asServiceRole.entities.PlanoPagamento.list(),
            base44.asServiceRole.entities.TabelaPreco.list(),
            base44.asServiceRole.entities.Segmento.list(),
            base44.asServiceRole.entities.Rede.list(),
            base44.asServiceRole.entities.Rota.list(),
            base44.asServiceRole.entities.Vendedor.list(),
            base44.asServiceRole.entities.ModalidadePagamento.list(),
        ]);

        // Mapas por nome normalizado
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

        // Vendedores: mapear por nome (fuzzy - contains)
        const vendedorList = vendedores.map(v => ({ id: v.id, nome: normalizeStr(v.nome), supervisor_id: v.supervisor_id }));

        const modalidadeMap = {};
        modalidades.forEach(m => { modalidadeMap[normalizeStr(m.nome)] = m.id; });

        function findPlanoId(csvVal) {
            const norm = normalizeStr(normalizePlano(csvVal));
            return planoMap[norm] || planoMap['AVISTA'];
        }

        function findTabelaId(csvVal) {
            const norm = normalizeStr(csvVal);
            if (!norm) return tabelaMap['TABELA 1'] || '';
            // Tentar match exato
            if (tabelaMap[norm]) return tabelaMap[norm];
            // Tentar match parcial
            for (const [key, id] of Object.entries(tabelaMap)) {
                if (key.includes(norm) || norm.includes(key)) return id;
            }
            return '';
        }

        function findSegmentoId(csvVal) {
            const norm = normalizeStr(csvVal);
            return segmentoMap[norm] || '';
        }

        function findRedeId(csvVal) {
            const norm = normalizeStr(csvVal);
            if (!norm) return '';
            return redeMap[norm] || '';
        }

        function findRotaId(csvVal) {
            const norm = normalizeStr(csvVal);
            if (!norm) return '';
            // Tentar match exato
            if (rotaMap[norm]) return rotaMap[norm];
            // Tentar normalizar: "ROTA 01 -MIGUEL" vs "ROTA 01 - MIGUEL"
            const normSpaces = norm.replace(/\s+/g, ' ').replace(/- /g, '- ').replace(/ -/g, ' -');
            for (const [key, id] of Object.entries(rotaMap)) {
                const keyNorm = key.replace(/\s+/g, ' ');
                if (keyNorm.includes(normSpaces) || normSpaces.includes(keyNorm)) return id;
            }
            // Tentar match parcial
            for (const [key, id] of Object.entries(rotaMap)) {
                if (key.includes(norm) || norm.includes(key)) return id;
            }
            // Mapear nomes especiais
            if (norm.includes('DELIVERY')) return rotaMap[normalizeStr('RETIRADA')] || '';
            if (norm.includes('MIX MATHEUS') || norm.includes('MIX MATEUS')) return rotaMap[normalizeStr('NOVO ATACAREJO')] || '';
            if (norm.includes('MANASSES')) return '';
            if (norm.includes('BALCAO')) return '';
            if (norm.includes('APLICATIVO')) return rotaMap[normalizeStr('APLICATIVO B2B')] || '';
            return '';
        }

        function findVendedorId(csvVal) {
            const norm = normalizeStr(csvVal);
            if (!norm) return '';
            // Tentar match exato
            const exact = vendedorList.find(v => v.nome === norm);
            if (exact) return exact.id;
            // Tentar match parcial (first name + last name)
            const partial = vendedorList.find(v => v.nome.includes(norm) || norm.includes(v.nome));
            if (partial) return partial.id;
            // Tentar por primeiro nome
            const firstName = norm.split(' ')[0];
            if (firstName.length > 3) {
                const byFirst = vendedorList.find(v => v.nome.startsWith(firstName));
                if (byFirst) return byFirst.id;
            }
            // Nomes especiais do CSV
            if (norm.includes('BALCAO') || norm.includes('APLICATIVO')) return '';
            return '';
        }

        function findSupervisorId(vendedorId) {
            if (!vendedorId) return '';
            const v = vendedorList.find(x => x.id === vendedorId);
            return v?.supervisor_id || '';
        }

        function findModalidadeId(csvVal) {
            const norm = normalizeStr(normalizeCobranca(csvVal));
            return modalidadeMap[norm] || modalidadeMap['PIX'] || '';
        }

        // 3. Buscar todos os clientes do sistema
        const clientesSistema = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
        console.log(`[sincronizarClientesCSV] Sistema: ${clientesSistema.length} clientes`);

        const sistemaMap = {};
        clientesSistema.forEach(c => { sistemaMap[c.codigo] = c; });

        const csvCodigos = new Set(csvRows.map(r => String(r.codigo).trim()));

        // 4. Classificar
        const paraAtualizar = [];
        const paraCriar = [];
        const paraExcluir = [];

        // CSV → Sistema
        for (const row of csvRows) {
            const cod = String(row.codigo).trim();
            if (!cod) continue;

            const clienteData = {
                codigo: cod,
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
                plano_pagamento_id: findPlanoId(row.plano_pagamento),
                tabela_id: findTabelaId(row.tabela_preco),
                segmento_id: findSegmentoId(row.segmento),
                rede_id: findRedeId(row.rede),
                rota_id: findRotaId(row.rota),
                vendedor_id: findVendedorId(row.vendedor),
                modalidade_pagamento_id: findModalidadeId(row.COBRANA),
            };
            clienteData.supervisor_id = findSupervisorId(clienteData.vendedor_id);

            if (sistemaMap[cod]) {
                paraAtualizar.push({ id: sistemaMap[cod].id, data: clienteData });
            } else {
                paraCriar.push(clienteData);
            }
        }

        // Sistema → CSV (excluir se não está no CSV)
        for (const cliente of clientesSistema) {
            if (!csvCodigos.has(cliente.codigo)) {
                paraExcluir.push({ id: cliente.id, codigo: cliente.codigo, nome: cliente.razao_social });
            }
        }

        console.log(`[sincronizarClientesCSV] Atualizar: ${paraAtualizar.length}, Criar: ${paraCriar.length}, Excluir: ${paraExcluir.length}`);

        // Modo análise: retornar resumo
        if (modo !== 'executar') {
            return Response.json({
                sucesso: true,
                modo: 'analise',
                csv_total: csvRows.length,
                sistema_total: clientesSistema.length,
                atualizar: paraAtualizar.length,
                criar: paraCriar.length,
                excluir: paraExcluir.length,
                excluir_preview: paraExcluir.slice(0, 20).map(e => `${e.codigo} - ${e.nome}`),
                criar_preview: paraCriar.slice(0, 20).map(c => `${c.codigo} - ${c.razao_social}`),
            });
        }

        // Modo executar
        let atualizados = 0, criados = 0, excluidos = 0, erros = 0;
        const errosList = [];

        // Atualizar existentes
        for (const item of paraAtualizar) {
            try {
                await base44.asServiceRole.entities.Cliente.update(item.id, item.data);
                atualizados++;
            } catch (e) {
                erros++;
                errosList.push(`Atualizar ${item.data.codigo}: ${e.message}`);
            }
        }
        console.log(`[sincronizarClientesCSV] Atualizados: ${atualizados}`);

        // Criar novos
        for (const data of paraCriar) {
            try {
                await base44.asServiceRole.entities.Cliente.create(data);
                criados++;
            } catch (e) {
                erros++;
                errosList.push(`Criar ${data.codigo}: ${e.message}`);
            }
        }
        console.log(`[sincronizarClientesCSV] Criados: ${criados}`);

        // Excluir
        for (const item of paraExcluir) {
            try {
                // Excluir do Omie primeiro
                const omieResult = await excluirClienteOmie(item.id);
                console.log(`[sincronizarClientesCSV] Omie excluir ${item.codigo}: ${omieResult.msg}`);
                // Aguardar 300ms para rate limit do Omie
                await new Promise(r => setTimeout(r, 300));
                // Excluir do sistema
                await base44.asServiceRole.entities.Cliente.delete(item.id);
                excluidos++;
            } catch (e) {
                erros++;
                errosList.push(`Excluir ${item.codigo}: ${e.message}`);
            }
        }
        console.log(`[sincronizarClientesCSV] Excluídos: ${excluidos}`);

        return Response.json({
            sucesso: true,
            modo: 'executar',
            csv_total: csvRows.length,
            sistema_total: clientesSistema.length,
            atualizados,
            criados,
            excluidos,
            erros,
            erros_detalhes: errosList.slice(0, 50),
        });

    } catch (error) {
        console.error('[sincronizarClientesCSV] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});