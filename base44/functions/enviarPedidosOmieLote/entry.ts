import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Envia múltiplos pedidos ao Omie em paralelo controlado.
 *
 * Limites Omie respeitados:
 * - 240 req/min por método (IncluirPedido) → janela de ~250ms entre disparos
 * - 4 requisições simultâneas por método → workers=3 (margem de segurança)
 *
 * Pré-carrega TODOS os dados auxiliares (clientes, produtos, unidades, planos, items)
 * em paralelo ANTES do loop — elimina N×K queries.
 */

const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";
const OMIE_CC_URL = "https://app.omie.com.br/api/v1/geral/contacorrente/";
const CONTA_CORRENTE_PADRAO = 11464371392;

const MAX_PEDIDOS_POR_CHAMADA = 200;
const WORKERS = 3; // máximo seguro (Omie permite 4 simultâneas)
const INTERVALO_MIN_MS = 280; // 240 req/min = 250ms; uso 280ms p/ folga

let OMIE_KEY = null;
let OMIE_SECRET = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function omieCall(url, payload, maxTent = 5) {
    let tent = 0;
    while (tent < maxTent) {
        tent += 1;
        let res, data;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, app_key: OMIE_KEY, app_secret: OMIE_SECRET })
            });
        } catch (e) {
            if (tent >= maxTent) throw e;
            await sleep(800 * tent + Math.random() * 300);
            continue;
        }
        if (res.status === 425) {
            return { faultstring: 'API Omie bloqueada (HTTP 425). Aguarde 30 minutos.', _http: 425 };
        }
        try { data = await res.json(); } catch { data = {}; }
        if (data?.faultstring) {
            const f = String(data.faultstring).toLowerCase();
            const isRedundante = f.includes('redundante') || f.includes('redundant');
            const isRate = f.includes('cota') || f.includes('aguarde') || f.includes('too many') || res.status === 429;
            if (isRedundante && tent < maxTent) { await sleep(15000); continue; }
            if (isRate && tent < maxTent) {
                const base = Math.min(8000, 1000 * Math.pow(2, tent - 1));
                await sleep(base + Math.random() * base * 0.3);
                continue;
            }
        }
        return data;
    }
    return { faultstring: 'Máximo de tentativas excedido' };
}

let _contaCorrenteCache = null;
async function resolverContaCorrente() {
    if (_contaCorrenteCache) return _contaCorrenteCache;
    try {
        const cc = await omieCall(OMIE_CC_URL, { call: "ListarContasCorrentes", param: [{ pagina: 1, registros_por_pagina: 50 }] }, 2);
        const lista = cc?.ListarContasCorrentes || cc?.conta_corrente_lista || [];
        if (lista.length > 0) {
            const padrao = lista.find(c => c.cPadrao === "S" || c.padrao === "S") || lista[0];
            _contaCorrenteCache = padrao.nCodCC || padrao.codigo || CONTA_CORRENTE_PADRAO;
            return _contaCorrenteCache;
        }
    } catch { /* ignore */ }
    _contaCorrenteCache = CONTA_CORRENTE_PADRAO;
    return _contaCorrenteCache;
}

function formatDateOmie(dateStr) {
    if (!dateStr) return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
    const s = String(dateStr).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, d] = s.split('T')[0].split('-');
        return `${d}/${m}/${y}`;
    }
    return s;
}

function gerarParcelas(plano, valorTotal) {
    const numParcelas = plano?.numero_parcelas || 1;
    const diasPrimeira = plano?.dias_primeira_parcela || 30;
    const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;
    const parcelas = [];
    const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' });
    const [yy, mm, dd] = hojeStr.split('-').map(Number);
    for (let i = 0; i < numParcelas; i++) {
        const diasOffset = diasPrimeira + (i * 30);
        const dataVenc = new Date(Date.UTC(yy, mm - 1, dd));
        dataVenc.setUTCDate(dataVenc.getUTCDate() + diasOffset);
        const d = String(dataVenc.getUTCDate()).padStart(2, '0');
        const m = String(dataVenc.getUTCMonth() + 1).padStart(2, '0');
        const y = dataVenc.getUTCFullYear();
        let valor = valorParcela;
        if (i === numParcelas - 1) {
            const totalAnterior = parcelas.reduce((s, p) => s + p.valor, 0);
            valor = Math.round((valorTotal - totalAnterior) * 100) / 100;
        }
        parcelas.push({
            numero_parcela: i + 1,
            data_vencimento: `${d}/${m}/${y}`,
            percentual: Math.round((100 / numParcelas) * 100) / 100,
            valor
        });
    }
    return parcelas;
}

function montarPayloadPedido(pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente) {
    const det = items.map((item) => {
        const prod = produtosMap[item.produto_id] || {};
        const unidade = prod.unidade_medida_id ? unidadesMap[prod.unidade_medida_id] : null;
        const unidadeStr = unidade?.nome || 'UN';
        const infAdic = {
            peso_bruto: (prod.peso || 0) * item.quantidade,
            peso_liquido: (prod.peso || 0) * item.quantidade
        };
        if (pedido.numero_pedido_compra) {
            infAdic.numero_pedido_compra = pedido.numero_pedido_compra;
            infAdic.dados_adicionais_item = `Pedido de Compra: ${pedido.numero_pedido_compra}`;
        }
        const produtoRef = prod.codigo_omie
            ? { codigo_produto: Number(prod.codigo_omie) }
            : { codigo_produto_integracao: item.produto_id };
        return {
            ide: { codigo_item_integracao: item.id },
            inf_adic: infAdic,
            produto: {
                ...produtoRef,
                descricao: item.produto_nome || prod.nome || '',
                ncm: prod.ncm || '',
                quantidade: item.quantidade,
                valor_unitario: item.valor_unitario,
                tipo_desconto: "V",
                valor_desconto: 0,
                unidade: unidadeStr
            }
        };
    });
    const parcelas = gerarParcelas(plano, pedido.valor_total || 0);
    const dadosAdicNf = pedido.dados_adicionais_nf || '';
    const cabecalho = {
        codigo_pedido_integracao: pedido.id,
        ...clientePayload,
        data_previsao: formatDateOmie(pedido.data_previsao_entrega),
        etapa: "10",
        codigo_parcela: "999",
        quantidade_itens: items.length
    };
    if (pedido.cenario_fiscal_codigo && !isNaN(Number(pedido.cenario_fiscal_codigo)) && Number(pedido.cenario_fiscal_codigo) > 0) {
        cabecalho.codigo_cenario_impostos = String(pedido.cenario_fiscal_codigo);
    }
    const payload = {
        cabecalho,
        det,
        frete: { modalidade: "9" },
        informacoes_adicionais: {
            codigo_categoria: "1.01.03",
            consumidor_final: "S",
            enviar_email: "N",
            codigo_conta_corrente: contaCorrente,
            ...(pedido.numero_pedido_compra ? { numero_pedido_cliente: pedido.numero_pedido_compra } : {}),
            ...(dadosAdicNf ? { dados_adicionais_nf: dadosAdicNf } : {})
        }
    };
    if (parcelas.length > 0) payload.lista_parcelas = { parcela: parcelas };
    return payload;
}

function resolverClientePayload(pedido, clienteBase44) {
    if (clienteBase44?.codigo_omie) {
        return { ok: true, payload: { codigo_cliente: Number(clienteBase44.codigo_omie) } };
    }
    const codIntegracao = pedido.cliente_codigo || pedido.cliente_id;
    if (codIntegracao) {
        return { ok: true, payload: { codigo_cliente_integracao: String(codIntegracao) } };
    }
    return { ok: false, erro: 'Cliente sem identificação' };
}

async function enviarUm(base44, pedido, ctx) {
    const t0 = Date.now();
    try {
        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
            return { pedido_id: pedido.id, sucesso: true, ja_enviado: true };
        }
        if (!pedido.data_previsao_entrega) {
            return { pedido_id: pedido.id, sucesso: false, erro: 'Sem data de previsão' };
        }
        if (pedido.tipo === 'troca') {
            return { pedido_id: pedido.id, sucesso: true, troca: true };
        }
        const items = ctx.itemsPorPedido[pedido.id] || [];
        if (items.length === 0) {
            return { pedido_id: pedido.id, sucesso: false, erro: 'Sem itens' };
        }
        const clienteBase44 = ctx.clientesPorId[pedido.cliente_id] || null;
        const plano = pedido.plano_pagamento_id ? ctx.planosPorId[pedido.plano_pagamento_id] : null;

        const r = resolverClientePayload(pedido, clienteBase44);
        if (!r.ok) {
            await base44.asServiceRole.entities.Pedido.update(pedido.id, { omie_erro: r.erro, omie_enviado: false });
            return { pedido_id: pedido.id, sucesso: false, erro: r.erro };
        }

        let payload = montarPayloadPedido(pedido, items, ctx.produtosMap, ctx.unidadesMap, plano, r.payload, ctx.contaCorrente);
        let resultado = await omieCall(OMIE_URL, { call: "IncluirPedido", param: [payload] });

        // Cliente não existe → exportar e re-tentar
        if (resultado?.faultstring && /cliente.*(não.*(localizado|encontrado|cadastrado)|invalid)/i.test(resultado.faultstring) && clienteBase44) {
            if (clienteBase44.tipo_nota === 'D1') {
                await base44.asServiceRole.entities.Pedido.update(pedido.id, { omie_erro: 'Cliente D1 não vai ao Omie', omie_enviado: false });
                return { pedido_id: pedido.id, sucesso: false, erro: 'Cliente D1 não vai ao Omie' };
            }
            const exp = await base44.asServiceRole.functions.invoke('enviarClienteOmie', {
                event: { type: 'auto_lote', entity_id: clienteBase44.id },
                data: clienteBase44
            });
            const d = exp?.data || exp;
            if (d?.sucesso) {
                await sleep(1500);
                payload = montarPayloadPedido(pedido, items, ctx.produtosMap, ctx.unidadesMap, plano,
                    { codigo_cliente_integracao: String(clienteBase44.id) }, ctx.contaCorrente);
                resultado = await omieCall(OMIE_URL, { call: "IncluirPedido", param: [payload] });
            } else {
                await base44.asServiceRole.entities.Pedido.update(pedido.id, { omie_erro: `Cliente não estava no Omie: ${d?.erro || 'falha'}`, omie_enviado: false });
                return { pedido_id: pedido.id, sucesso: false, erro: `Cliente não estava no Omie: ${d?.erro || 'falha'}` };
            }
        }

        // Já existe → idempotência
        if (resultado?.faultstring && /(já cadastrado|já existe)/i.test(resultado.faultstring)) {
            const consulta = await omieCall(OMIE_URL, { call: "ConsultarPedido", param: [{ codigo_pedido_integracao: pedido.id }] }, 2);
            if (!consulta?.faultstring && consulta?.cabecalho) {
                const codigoOmie = consulta.cabecalho.codigo_pedido || null;
                const numeroPedidoOmie = consulta.cabecalho.numero_pedido || null;
                const upd = {
                    omie_codigo_pedido: codigoOmie != null ? String(codigoOmie) : null,
                    omie_enviado: true,
                    omie_erro: null,
                    status: pedido.status === 'pendente' ? 'enviado' : pedido.status,
                    data_envio: pedido.data_envio || new Date().toISOString()
                };
                if (numeroPedidoOmie) upd.numero_pedido = String(numeroPedidoOmie);
                await base44.asServiceRole.entities.Pedido.update(pedido.id, upd);
                return { pedido_id: pedido.id, sucesso: true, codigo_pedido_omie: codigoOmie, numero_pedido_omie: numeroPedidoOmie, ja_existia: true };
            }
        }

        if (resultado?.faultstring) {
            await base44.asServiceRole.entities.Pedido.update(pedido.id, { omie_erro: resultado.faultstring, omie_enviado: false });
            return { pedido_id: pedido.id, sucesso: false, erro: resultado.faultstring, duracao_ms: Date.now() - t0 };
        }

        const codigoOmie = resultado.codigo_pedido || resultado.codigo_pedido_omie || null;
        const numeroPedidoOmie = resultado.numero_pedido || resultado.numero_pedido_omie || null;
        const upd = {
            omie_codigo_pedido: codigoOmie != null ? String(codigoOmie) : null,
            omie_enviado: true,
            omie_erro: null,
            status: pedido.status === 'pendente' ? 'enviado' : pedido.status,
            data_envio: pedido.data_envio || new Date().toISOString()
        };
        if (numeroPedidoOmie) {
            upd.numero_pedido = String(numeroPedidoOmie);
            const dadosAtuais = pedido.dados_adicionais_nf || '';
            const semPrefixo = dadosAtuais.replace(/^Pedido Nº: .+?(\s*\|\s*|$)/, '').trim();
            const partes = [`Pedido Nº: ${numeroPedidoOmie}`];
            if (semPrefixo) partes.push(semPrefixo);
            upd.dados_adicionais_nf = partes.join(' | ');
        }
        await base44.asServiceRole.entities.Pedido.update(pedido.id, upd);
        return { pedido_id: pedido.id, sucesso: true, codigo_pedido_omie: codigoOmie, numero_pedido_omie: numeroPedidoOmie, duracao_ms: Date.now() - t0 };

    } catch (err) {
        try { await base44.asServiceRole.entities.Pedido.update(pedido.id, { omie_erro: `Erro: ${err.message}`, omie_enviado: false }); } catch { /* ignore */ }
        return { pedido_id: pedido.id, sucesso: false, erro: err.message, duracao_ms: Date.now() - t0 };
    }
}

Deno.serve(async (req) => {
    const tInicio = Date.now();
    try {
        const base44 = createClientFromRequest(req);
        OMIE_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
        OMIE_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
        if (!OMIE_KEY || !OMIE_SECRET) {
            return Response.json({ sucesso: false, erro: 'Credenciais Omie não configuradas' }, { status: 500 });
        }
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        // Permissão
        if (user.role !== 'admin') {
            const allVendedores = await base44.asServiceRole.entities.Vendedor.list();
            const vendedor = allVendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
            if (!vendedor) return Response.json({ error: 'Funcionário não encontrado' }, { status: 403 });
            const perms = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedor.id });
            if (!perms[0]?.permissoes_pedidos?.enviar_pedido) {
                return Response.json({ error: 'Sem permissão para enviar pedidos' }, { status: 403 });
            }
        }

        const body = await req.json();
        const pedidoIds = Array.isArray(body.pedido_ids) ? body.pedido_ids : [];
        if (pedidoIds.length === 0) return Response.json({ error: 'pedido_ids é obrigatório' }, { status: 400 });
        if (pedidoIds.length > MAX_PEDIDOS_POR_CHAMADA) {
            return Response.json({ error: `Máximo ${MAX_PEDIDOS_POR_CHAMADA} pedidos por chamada` }, { status: 400 });
        }

        // PRÉ-CARREGA TUDO em paralelo
        const [allItems, allClientes, allProdutos, allUnidades, allPlanos] = await Promise.all([
            base44.asServiceRole.entities.PedidoItem.list(),
            base44.asServiceRole.entities.Cliente.list(),
            base44.asServiceRole.entities.Produto.list(),
            base44.asServiceRole.entities.UnidadeMedida.list(),
            base44.asServiceRole.entities.PlanoPagamento.list()
        ]);
        // Buscar os pedidos
        const pedidos = [];
        for (const pid of pedidoIds) {
            try { const p = await base44.asServiceRole.entities.Pedido.get(pid); if (p) pedidos.push(p); } catch { /* ignore */ }
        }

        // Indexar
        const itemsPorPedido = {};
        for (const it of allItems) {
            if (!itemsPorPedido[it.pedido_id]) itemsPorPedido[it.pedido_id] = [];
            itemsPorPedido[it.pedido_id].push(it);
        }
        const clientesPorId = Object.fromEntries(allClientes.map(c => [c.id, c]));
        const planosPorId = Object.fromEntries(allPlanos.map(p => [p.id, p]));
        const produtosMap = Object.fromEntries(allProdutos.map(p => [p.id, p]));
        const unidadesMap = Object.fromEntries(allUnidades.map(u => [u.id, u]));
        const contaCorrente = await resolverContaCorrente();

        const ctx = { itemsPorPedido, clientesPorId, planosPorId, produtosMap, unidadesMap, contaCorrente };

        // Fila com WORKERS paralelos respeitando intervalo mínimo
        const resultados = [];
        let idx = 0;
        let ultimoDisparo = 0;

        async function worker() {
            while (idx < pedidos.length) {
                const i = idx++;
                const pedido = pedidos[i];

                // Garante INTERVALO_MIN_MS entre disparos (token bucket simplificado)
                const agora = Date.now();
                const esperar = Math.max(0, ultimoDisparo + INTERVALO_MIN_MS - agora);
                if (esperar > 0) await sleep(esperar);
                ultimoDisparo = Date.now();

                const r = await enviarUm(base44, pedido, ctx);
                resultados.push(r);
            }
        }
        await Promise.all(Array.from({ length: Math.min(WORKERS, pedidos.length) }, () => worker()));

        const sucessos = resultados.filter(r => r.sucesso).length;
        const erros = resultados.filter(r => !r.sucesso).length;

        return Response.json({
            sucesso: true,
            total: pedidos.length,
            sucessos,
            erros,
            duracao_ms: Date.now() - tInicio,
            resultados
        });
    } catch (err) {
        console.error('[enviarPedidosOmieLote] Erro geral:', err.message);
        return Response.json({ sucesso: false, erro: err.message }, { status: 500 });
    }
});