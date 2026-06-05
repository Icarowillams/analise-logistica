import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_URL = 'https://app.omie.com.br/api/v1/geral/produtos/';

// Helper Omie padronizado: mantém retorno bruto para preservar a lógica existente desta função.
async function omieFetchComRetry(url, payload, tentativa = 1, maxTentativas = 3) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.faultstring) {
        const msg = data.faultstring.toLowerCase();
        const isBlocked = msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde') || res.status === 425;
        const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon') || res.status === 429;
        if (isBlocked) return data;
        if (isRate && tentativa < maxTentativas) {
            await new Promise(r => setTimeout(r, 2500 * tentativa));
            return omieFetchComRetry(url, payload, tentativa + 1, maxTentativas);
        }
    }
    return data;
}

async function logOmie(base44, payload) {
    try {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create(payload);
    } catch (_) { /* log best-effort */ }
}

function removeQuotes(val) {
    if (typeof val !== 'string') return val;
    let v = val.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

function cleanStrings(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = typeof v === 'string' ? removeQuotes(v) : v;
    }
    return out;
}

function mapearProdutoParaOmie(produto, unidadeSigla) {
    const ncm = (produto.ncm || '').replace(/\D/g, '') || '19059090';
    const cest = (produto.cest || '').replace(/\D/g, '');
    const codigo = String(produto.codigo || '').trim();

    // NCM precisa ter exatamente 8 dígitos para Omie aceitar
    const ncm8 = ncm.padStart(8, '0').substring(0, 8);

    const produtoOmie = {
        codigo_produto_integracao: codigo,
        codigo: codigo.substring(0, 60),
        descricao: (produto.nome || 'Produto sem nome').trim().substring(0, 120),
        unidade: (unidadeSigla || 'UN').substring(0, 6).toUpperCase(),
        ncm: ncm8,
        tipoItem: '00', // 00 = Mercadoria para Revenda (padrão geral)
        peso_bruto: Number(produto.peso) || 0,
        peso_liq: Number(produto.peso) || 0,
        bloqueado: produto.status === 'inativo' ? 'S' : 'N',
        bloquear_exclusao: 'N',
        inativo: produto.status === 'inativo' ? 'S' : 'N'
    };

    if (cest) produtoOmie.cest = cest.substring(0, 9);

    if (produto.cod_barras && String(produto.cod_barras).trim()) {
        produtoOmie.ean = String(produto.cod_barras).replace(/\D/g, '').substring(0, 14);
    }

    // Descrição detalhada (se houver)
    if (produto.descricao && produto.descricao.trim()) {
        produtoOmie.descr_detalhada = produto.descricao.trim().substring(0, 2000);
    }

    return produtoOmie;
}

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    let entidadeId = null;
    let produtoData = null;

    try {
        const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
        const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

        if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
            return Response.json({
                sucesso: false,
                erro: 'OMIE_APP_KEY ou OMIE_APP_SECRET não configurados'
            });
        }

        const body = await req.json();
        const { event, data } = body;
        produtoData = data;
        entidadeId = event?.entity_id || data?.id;

        // Recarregar se payload_too_large ou campos ausentes
        if ((body.payload_too_large || !produtoData || !produtoData.nome || !produtoData.codigo) && entidadeId) {
            produtoData = await base44.asServiceRole.entities.Produto.get(entidadeId);
        }

        if (!produtoData || !entidadeId) {
            return Response.json({ sucesso: false, erro: 'Produto não informado' }, { status: 400 });
        }

        if (!produtoData.id) produtoData.id = entidadeId;

        // Validações mínimas
        if (!produtoData.nome || !produtoData.codigo) {
            const erro = 'Produto precisa de nome e codigo';
            await logOmie(base44, {
                endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
                entidade_tipo: 'Produto', entidade_id: entidadeId,
                status: 'erro', mensagem_erro: erro, tentativas: 1
            });
            return Response.json({ sucesso: false, erro, produto_id: entidadeId });
        }

        // Ignorar tipos que não sobem ao Omie
        if (produtoData.tipo === 'bonificacao') {
            await logOmie(base44, {
                endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
                entidade_tipo: 'Produto', entidade_id: entidadeId,
                status: 'warning', mensagem_erro: 'Produto tipo=bonificacao: não envia ao Omie',
                tentativas: 1
            });
            return Response.json({ sucesso: false, pulado: true, motivo: 'bonificacao', produto_id: entidadeId });
        }

        produtoData = cleanStrings(produtoData);

        // Buscar sigla da unidade de medida
        let unidadeSigla = 'UN';
        if (produtoData.unidade_medida_id) {
            try {
                const unidade = await base44.asServiceRole.entities.UnidadeMedida.get(produtoData.unidade_medida_id);
                if (unidade?.nome) unidadeSigla = unidade.nome;
            } catch (_) { /* fallback UN */ }
        }

        const produtoOmie = mapearProdutoParaOmie(produtoData, unidadeSigla);

        // Pré-consulta por código interno: se já existe no Omie, reutilizar o codigo_produto_integracao real
        try {
            const achado = await omieFetchComRetry(OMIE_URL, {
                call: 'ConsultarProduto',
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{ codigo: produtoOmie.codigo }]
            });
            if (achado?.codigo_produto) {
                produtoOmie.codigo_produto = achado.codigo_produto;
                if (achado.codigo_produto_integracao && achado.codigo_produto_integracao !== produtoOmie.codigo_produto_integracao) {
                    produtoOmie.codigo_produto_integracao = achado.codigo_produto_integracao;
                }
            }
        } catch (_) { /* pré-consulta é best-effort */ }

        const started = Date.now();
        const resultado = await omieFetchComRetry(OMIE_URL, {
            call: 'UpsertProduto',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [produtoOmie]
        });
        const duracao_ms = Date.now() - started;

        if (resultado.faultstring || resultado.faultcode) {
            await logOmie(base44, {
                endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
                entidade_tipo: 'Produto', entidade_id: entidadeId,
                status: 'erro',
                codigo_erro: resultado.faultcode,
                mensagem_erro: resultado.faultstring,
                payload_enviado: JSON.stringify(produtoOmie).slice(0, 2000),
                payload_resposta: JSON.stringify(resultado).slice(0, 2000),
                duracao_ms, tentativas: 1
            });
            return Response.json({
                sucesso: false,
                erro: resultado.faultstring || 'Falha Omie',
                codigo_erro: resultado.faultcode,
                produto_id: entidadeId
            });
        }

        // Gravar codigo_omie no Base44
        if (resultado.codigo_produto) {
            try {
                await base44.asServiceRole.entities.Produto.update(entidadeId, {
                    codigo_omie: String(resultado.codigo_produto)
                });
            } catch (e) {
                console.log('[enviarProdutoOmie] Falha ao gravar codigo_omie:', e.message);
            }
        }

        await logOmie(base44, {
            endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
            entidade_tipo: 'Produto', entidade_id: entidadeId,
            status: 'sucesso',
            payload_enviado: JSON.stringify(produtoOmie).slice(0, 2000),
            payload_resposta: JSON.stringify(resultado).slice(0, 2000),
            duracao_ms, tentativas: 1
        });

        return Response.json({
            sucesso: true,
            produto_id: entidadeId,
            codigo_omie: resultado.codigo_produto,
            mensagem: resultado.descricao_status || 'Produto enviado com sucesso'
        });

    } catch (error) {
        await logOmie(base44, {
            endpoint: 'geral/produtos', call: 'UpsertProduto', operacao: 'enviar_produto',
            entidade_tipo: 'Produto', entidade_id: entidadeId,
            status: 'erro', mensagem_erro: error.message, tentativas: 1
        });
        return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
    }
});