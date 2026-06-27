import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function getOmieCredentials(base44) {
    const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
    const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
    if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
    const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    const cfg = rows?.[0];
    return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

async function checkCircuitBreaker(base44) {
    const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
    const c = rows?.[0];
    if (!c?.bloqueado) return { blocked: false };
    if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
        return { blocked: false };
    }
    return { blocked: true, blockedUntil: c.bloqueado_ate };
}

// omieCall canônico (canal único ao Omie). Auto-contido. Em faultstring devolve o objeto bruto
// (preserva o tratamento de erro por produto desta função). Registra circuit breaker em bloqueio/425.
async function omieCall(base44, endpoint, param, options = {}) {
    const { appKey, appSecret } = await getOmieCredentials(base44);
    const call = options.call || '';
    if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
    if (!call) throw new Error('Informe options.call com o método Omie.');
    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
    const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
    const RETRIES = [2500, 5000];
    for (let i = 0; i <= RETRIES.length; i++) {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
        let res;
        try {
            res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
        } catch (e) {
            clearTimeout(tid);
            if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
            return { faultstring: e.name === 'AbortError' ? 'Timeout na chamada Omie' : e.message };
        }
        clearTimeout(tid);
        if (res.status >= 500 || res.status === 429) {
            const corpo = await res.text().catch(() => '');
            if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
            return { faultstring: `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}` };
        }
        if (res.status === 425) {
            const corpo = await res.text().catch(() => '');
            const _rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
            const _cb = _rows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
            const _p = { erros_consecutivos: _erros, ultimo_erro: `HTTP 425${corpo ? ': ' + corpo.slice(0, 200) : ''}`, atualizado_em: new Date().toISOString() };
            if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
            await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
            return { faultstring: `HTTP 425 — consumo indevido${corpo ? ': ' + corpo.slice(0, 200) : ''}`, faultcode: '425' };
        }
        const data = await res.json().catch(() => ({ faultstring: 'Resposta Omie inválida' }));
        if (data.faultstring) {
            const msg = String(data.faultstring).toLowerCase();
            const isBlocked = msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('consumo indevido');
            const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon');
            if (isBlocked) {
                const _rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
                const _cb = _rows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
                const _secs = (() => { const m = String(data.faultstring).match(/(\d+)\s*segundo/i); return m ? Math.min(Number(m[1]), 1800) : 0; })();
                const _p = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() };
                if (_erros >= _thresh && _secs > 0) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + _secs * 1000).toISOString(); }
                await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, _p).catch(() => null);
                return data;
            }
            if (isRate && i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
            return data;
        }
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
        return data;
    }
    return { faultstring: 'Máximo de tentativas Omie excedido' };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { produto_ids, modo = "upsert", lote_inicio = 0 } = body;

        if (!produto_ids || !Array.isArray(produto_ids) || produto_ids.length === 0) {
            return Response.json({ error: 'Informe os IDs dos produtos para exportar' }, { status: 400 });
        }

        // Processar no máximo 10 produtos por chamada (Omie tem limite rigoroso de ~50 req/min)
        const LOTE_MAX = 10;
        const produtosDoLote = produto_ids.slice(lote_inicio, lote_inicio + LOTE_MAX);
        
        if (produtosDoLote.length === 0) {
            return Response.json({ 
                concluido: true,
                resumo: { total: 0, sucessos: 0, erros: 0 },
                resultados: []
            });
        }

        // Buscar produtos, unidades de medida e categorias
        const [produtos, unidadesMedida, categorias] = await Promise.all([
            base44.entities.Produto.list(),
            base44.entities.UnidadeMedida.list(),
            base44.entities.Categoria.list()
        ]);

        // Deduplicação por código de produto — evita UpsertProduto redundante no mesmo lote
        const vistosCodigo = new Set();
        const produtosParaExportar = produtos
            .filter(p => produtosDoLote.includes(p.id))
            .filter(p => {
                const cod = String(p.codigo || p.id).trim();
                if (vistosCodigo.has(cod)) return false;
                vistosCodigo.add(cod);
                return true;
            });

        const resultados = [];
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // Roteia tudo pelo gateway canônico (omieCall). Mantém a assinatura omieFetch(call, param)
        // para preservar os pontos de uso (ConsultarProduto + Upsert/IncluirProduto).
        const omieFetch = (call, param) => omieCall(base44, "geral/produtos/", param, { call, skipLog: true });

        for (const produto of produtosParaExportar) {
            // Buscar unidade de medida - usar o nome como sigla (UN, KG, FD, PCT, GR)
            const unidade = unidadesMedida.find(u => u.id === produto.unidade_medida_id);
            const unidadeSigla = unidade?.nome?.substring(0, 6)?.toUpperCase() || "UN";

            // Buscar categoria
            const categoria = categorias.find(c => c.id === produto.categoria_id);

            // Campos obrigatórios conforme documentação Omie API:
            // - codigo_produto_integracao: código único de integração (nosso ID interno)
            // - codigo: código do produto (até 60 caracteres)
            // - descricao: nome/descrição do produto (até 120 caracteres)
            // - unidade: unidade de medida (UN, KG, CX, FD, PCT, GR, etc)
            // - ncm: NCM obrigatório (8 dígitos) - usar 1905.90.90 como padrão para pães
            // - cest: CEST opcional (7 dígitos)
            const ncmProduto = produto.ncm?.replace(/[^\d]/g, "") || "19059090"; // NCM padrão: Outros produtos de padaria
            const cestProduto = produto.cest?.replace(/[^\d]/g, "") || "";
            
            const produtoOmie = {
                codigo_produto_integracao: produto.id,
                codigo: (produto.codigo || produto.id).substring(0, 60),
                descricao: (produto.nome || "Produto sem nome").substring(0, 120),
                unidade: unidadeSigla,
                ncm: ncmProduto.substring(0, 8),
                peso_bruto: produto.peso || 0,
                peso_liq: produto.peso || 0,
                bloqueado: produto.status === 'inativo' ? "S" : "N",
                bloquear_exclusao: "N",
                inativo: produto.status === 'inativo' ? "S" : "N"
            };

            // CEST - campo na raiz (string9, deprecated mas ainda funcional)
            if (cestProduto) {
                produtoOmie.cest = cestProduto.substring(0, 9);
            }

            // Adicionar código de barras se existir (EAN/GTIN - até 14 dígitos)
            if (produto.cod_barras && produto.cod_barras.trim()) {
                produtoOmie.ean = produto.cod_barras.replace(/[^\d]/g, "").substring(0, 14);
            }

            // Adicionar descrição detalhada com categoria se existir
            if (categoria) {
                produtoOmie.descr_detalhada = `Categoria: ${categoria.nome}`.substring(0, 5000);
            }

            // Pré-consulta: injeta codigo_produto numérico para forçar UPDATE em vez de INSERT
            // Tenta primeiro pelo codigo_omie salvo localmente, depois pelo campo "codigo" (ex: "11")
            try {
                const codigoOmieLocal = produto.codigo_omie ? Number(produto.codigo_omie) : null;
                const paramConsulta = codigoOmieLocal
                    ? { codigo_produto: codigoOmieLocal }
                    : { codigo: produtoOmie.codigo };
                const achado = await omieFetch('ConsultarProduto', paramConsulta);
                if (achado?.codigo_produto) {
                    produtoOmie.codigo_produto = achado.codigo_produto;
                    if (achado.codigo_produto_integracao) {
                        produtoOmie.codigo_produto_integracao = achado.codigo_produto_integracao;
                    }
                    // Persiste codigo_omie localmente para próximas exportações
                    if (!codigoOmieLocal) {
                        await base44.entities.Produto.update(produto.id, { codigo_omie: String(achado.codigo_produto) }).catch(() => {});
                    }
                }
            } catch (_) { /* pré-consulta best-effort */ }

            const metodo = modo === "incluir" ? "IncluirProduto" : "UpsertProduto";

            try {
                const resultado = await omieFetch(metodo, produtoOmie);

                resultados.push({
                    produto_id: produto.id,
                    nome: produto.nome,
                    codigo: produto.codigo,
                    sucesso: !resultado.faultstring,
                    codigo_omie: resultado.codigo_produto || null,
                    mensagem: resultado.faultstring || resultado.descricao_status || "Exportado com sucesso"
                });
            } catch (err) {
                resultados.push({
                    produto_id: produto.id,
                    nome: produto.nome,
                    codigo: produto.codigo,
                    sucesso: false,
                    codigo_omie: null,
                    mensagem: err.message
                });
            }

            // Aguardar 3000ms entre requisições para evitar rate limit da Omie
            // A API Omie tem limite rigoroso e bloqueia por 30 minutos se exceder
            await delay(3000);
        }

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.filter(r => !r.sucesso).length;
        const proximoLote = lote_inicio + LOTE_MAX;
        const concluido = proximoLote >= produto_ids.length;

        return Response.json({
            concluido,
            proximo_lote: concluido ? null : proximoLote,
            total_geral: produto_ids.length,
            resumo: {
                total: resultados.length,
                sucessos,
                erros
            },
            resultados
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});