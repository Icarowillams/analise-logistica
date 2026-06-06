import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7: migrado para _shared/omieClient
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";
const OMIE_CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/";
const OMIE_CC_URL = "https://app.omie.com.br/api/v1/geral/contacorrente/";
const CONTA_CORRENTE_PADRAO = 11464371392; // Centralizado em constantes.ts

// ============================================================
// HELPER OMIE — rate-limit aware (240 req/min, 4 concurrent, redundância 60s, 425 = bloqueio 30min)
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Log de debug: grava em console + entidade LogIntegracaoOmie (transparência do fluxo)
function debugLog(base44, mensagem, extra = {}) {
  console.log(mensagem);
  // FIRE-AND-FORGET: não usa await para não bloquear o envio do pedido
  base44.asServiceRole.entities.LogIntegracaoOmie.create({
    endpoint: 'enviarPedidoOmie:debug',
    payload_envio: JSON.stringify(extra).slice(0, 2000),
    payload_resposta: mensagem.slice(0, 2000),
    sucesso: !extra.erro,
    erro: extra.erro || null,
    created_date: new Date().toISOString()
  }).catch(() => {});
}

// omieCall robusto: circuit breaker + 425 (bloqueio 30min, sem retry) + retry 429 + log padronizado.
// O endpoint base usa /produtos/pedido/ para pedidos; para chamadas gerais (contas correntes) usa /geral/.
// ✅ resolverCreds removida — _shared/omieClient

// ✅ omieCall local removida — wrapper para _shared/omieClient  
async function omieCall(base44, ...args) {
  // Detecta chamada (base44, call, param) ou (base44, endpoint, param, opts)
  const [callOrEndpoint, param, opts] = args;
  if (opts !== undefined || (typeof callOrEndpoint === 'string' && callOrEndpoint.includes('/'))) {
    return omieCallShared(base44, callOrEndpoint, param, opts || {});
  }
  return omieCallShared(base44, 'produtos/pedido/', param, { call: callOrEndpoint });
}

let _contaCorrenteCache = null; // TTL: vida do worker (máx 30s no _shared)
let _unidadesCache = null;
async function resolverContaCorrentePadrao(base44) {
    if (_contaCorrenteCache) return _contaCorrenteCache;
    try {
        const cc = await omieCall(base44, "ListarContasCorrentes", { pagina: 1, registros_por_pagina: 50 }, { maxTentativas: 2 });
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

// Formata data DD/MM/YYYY (sem deslocamento de timezone)
function formatDateOmie(dateStr) {
    if (!dateStr) {
        return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
    }
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
    // dataBase = hoje em America/Recife → constrói via toLocaleDateString pra evitar UTC shift
    const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' }); // YYYY-MM-DD
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

// ============================================================
// RESOLUÇÃO DE CLIENTE — caminho feliz: 0 chamadas Omie
// ============================================================
async function resolverClienteOmie(base44, pedido, clienteBase44) {
    // 1. Caminho feliz: cliente local tem codigo_omie → confiamos no codigo_cliente_integracao que já existe
    //    O Omie aceita codigo_cliente_integracao OU codigo_cliente_omie no IncluirPedido. Vamos preferir codigo_cliente_omie quando temos.
    if (clienteBase44?.codigo_omie) {
        return {
            ok: true,
            payload: { codigo_cliente: Number(clienteBase44.codigo_omie) },
            fonte: 'local_codigo_omie'
        };
    }

    // 2. Tem codigo_cliente_integracao (id Base44 ou campo codigo)?
    const codIntegracao = pedido.cliente_codigo || pedido.cliente_id;
    if (codIntegracao) {
        return {
            ok: true,
            payload: { codigo_cliente_integracao: String(codIntegracao) },
            fonte: 'local_codigo_integracao',
            precisaValidar: !clienteBase44?.codigo_omie // se nunca foi validado, vale fallback no erro
        };
    }

    return { ok: false, erro: 'Cliente sem identificação para o Omie' };
}

// Fallback: cliente não existe no Omie → exportar e tentar de novo
async function exportarClienteSeNecessario(base44, clienteBase44) {
    if (!clienteBase44) return { ok: false, erro: 'Cliente Base44 inexistente' };
    if (clienteBase44.tipo_nota === 'D1') {
        return { ok: false, erro: 'Cliente marcado como D1 (sem NF)' };
    }
    const r = await base44.asServiceRole.functions.invoke('enviarClienteOmie', {
        event: { type: 'auto_pedido', entity_id: clienteBase44.id },
        data: clienteBase44
    });
    const d = r?.data || r;
    if (!d?.sucesso) return { ok: false, erro: d?.erro || 'Falha exportando cliente' };
    return { ok: true, codigo_omie: d.codigo_omie };
}

// ============================================================
// MONTAGEM DO PAYLOAD
// ============================================================
function montarPayloadPedido({ pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente, numeroPedidoPreenchido }) {
    const dataPrevisao = formatDateOmie(pedido.data_previsao_entrega);

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

    // dados_adicionais_nf: já incluímos placeholder; Omie preenche {nrPedido} se existir, senão fica vazio
    // Como não temos o número do pedido ainda, usamos o pedido.dados_adicionais_nf direto
    const identificacaoCliente = [
        pedido.cliente_nome_fantasia || pedido.cliente_nome || '',
        pedido.cliente_codigo || ''
    ].filter(Boolean).join(' - ');
    const dadosAdicNfOriginal = pedido.dados_adicionais_nf || '';
    const jaTemIdentificacao = identificacaoCliente && dadosAdicNfOriginal.startsWith(identificacaoCliente);
    const dadosAdicNf = identificacaoCliente
        ? (jaTemIdentificacao ? dadosAdicNfOriginal : [identificacaoCliente, dadosAdicNfOriginal].filter(Boolean).join(' | '))
        : dadosAdicNfOriginal;

    const cabecalho = {
        codigo_pedido_integracao: pedido.id,
        ...clientePayload, // codigo_cliente OU codigo_cliente_integracao
        data_previsao: dataPrevisao,
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
            codigo_categoria: "1.01.01",
            consumidor_final: "S",
            enviar_email: "N",
            codigo_conta_corrente: contaCorrente,
            ...(pedido.numero_pedido_compra ? { numero_pedido_cliente: pedido.numero_pedido_compra } : {}),
            ...(dadosAdicNf ? { dados_adicionais_nf: dadosAdicNf } : {})
        }
    };
    if (parcelas.length > 0) {
        payload.lista_parcelas = { parcela: parcelas };
    }
    return payload;
}

// ============================================================
// CORE: envia 1 pedido
// ============================================================
async function enviarUmPedido(base44, pedido_id, ctx = {}) {
    const t0 = Date.now();

    // Buscar pedido
    let pedido;
    try {
        pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
    } catch (e) {
        if (/not found/i.test(e.message)) return { sucesso: false, erro: 'Pedido não encontrado', pedido_id };
        throw e;
    }
    if (!pedido) return { sucesso: false, erro: 'Pedido não encontrado', pedido_id };

    debugLog(base44, `[enviarPedidoOmie] Iniciando envio do pedido ID: ${pedido_id}, modelo_nota: ${pedido.modelo_nota}, tipo: ${pedido.tipo}`, { pedido_id, modelo_nota: pedido.modelo_nota, tipo: pedido.tipo, cliente_id: pedido.cliente_id, status: pedido.status });

    if (!['pendente', 'enviado', 'liberado'].includes(pedido.status)) {
        return { sucesso: false, erro: 'Status inválido para envio', pedido_id };
    }

    // Idempotência: já enviado
    if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
        return {
            sucesso: true,
            pedido_id,
            codigo_pedido_omie: pedido.omie_codigo_pedido,
            numero_pedido_omie: pedido.numero_pedido,
            mensagem: 'Pedido já estava enviado ao Omie'
        };
    }

    if (!pedido.data_previsao_entrega) {
        return { sucesso: false, erro: 'Data de Previsão de Entrega é obrigatória', pedido_id };
    }
    if (pedido.tipo === 'troca') {
        debugLog(base44, `[enviarPedidoOmie] Pedido tratado como interno — abortando envio ao Omie. Motivo: tipo === 'troca'`, { pedido_id, motivo: 'troca' });
        return { sucesso: true, pedido_id, codigo_pedido_omie: null, mensagem: 'Troca não gera venda no Omie' };
    }
    if (pedido.modelo_nota === 'd1') {
        debugLog(base44, `[enviarPedidoOmie] Pedido tratado como interno — abortando envio ao Omie. Motivo: modelo_nota === 'd1'`, { pedido_id, motivo: 'd1' });
        return { sucesso: false, erro: 'Pedido modelo D1 não é enviado ao Omie (venda interna)', pedido_id };
    }

    // Itens
    const items = ctx.itemsPorPedido?.[pedido_id]
        || await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });
    if (items.length === 0) return { sucesso: false, erro: 'Pedido sem itens', pedido_id };

    // Cliente
    let clienteBase44 = ctx.clientesPorId?.[pedido.cliente_id] || null;
    if (!clienteBase44 && pedido.cliente_id) {
        try { clienteBase44 = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id); } catch { /* ignore */ }
    }

    debugLog(base44, `[enviarPedidoOmie] Cliente ID: ${pedido.cliente_id}, tipo_nota: ${clienteBase44?.tipo_nota}`, { cliente_id: pedido.cliente_id, tipo_nota: clienteBase44?.tipo_nota, codigo_omie: clienteBase44?.codigo_omie });

    if (clienteBase44?.tipo_nota === 'D1') {
        debugLog(base44, `[enviarPedidoOmie] Pedido tratado como interno — abortando envio ao Omie. Motivo: cliente tipo_nota === 'D1'`, { pedido_id, motivo: 'cliente_d1' });
        await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: 'Cliente marcado como D1 (sem NF) — não enviado ao Omie', omie_enviado: false });
        return { sucesso: false, erro: 'Cliente marcado como D1 (sem NF) — não enviado ao Omie', pedido_id };
    }

    // Plano
    let plano = ctx.planosPorId?.[pedido.plano_pagamento_id] || null;
    if (!plano && pedido.plano_pagamento_id) {
        try { plano = await base44.asServiceRole.entities.PlanoPagamento.get(pedido.plano_pagamento_id); } catch { /* ignore */ }
    }

    // Produtos — busca em paralelo (Promise.all ao invés de loop síncrono)
    const produtosMap = ctx.produtosMap || {};
    if (!ctx.produtosMap) {
        const produtoIds = [...new Set(items.map(i => i.produto_id))];
        const produtos = await Promise.all(
            produtoIds.map(pid => base44.asServiceRole.entities.Produto.get(pid).catch(() => null))
        );
        produtos.forEach(p => { if (p) produtosMap[p.id] = p; });
    }
    // Unidades — cache global por execução
    const unidadesMap = ctx.unidadesMap || {};
    if (!ctx.unidadesMap) {
        if (!_unidadesCache) {
            _unidadesCache = await base44.asServiceRole.entities.UnidadeMedida.list();
        }
        _unidadesCache.forEach(u => { unidadesMap[u.id] = u; });
    }

    // Resolver cliente (caminho feliz: 0 chamadas Omie)
    let res = await resolverClienteOmie(base44, pedido, clienteBase44);
    if (!res.ok) return { sucesso: false, erro: res.erro, pedido_id };
    let clientePayload = res.payload;

    // Conta corrente padrão resolvida uma única vez por execução/lote
    const contaCorrente = ctx.contaCorrentePadrao || await resolverContaCorrentePadrao(base44);

    // ENVIAR
    const payload = montarPayloadPedido({ pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente });
    let resultado = await omieCall(base44, "IncluirPedido", payload);

    // Se cliente não existe no Omie → exportar e tentar UMA VEZ MAIS
    const erroClienteNaoExiste = resultado?.faultstring && /cliente.*(não.*(localizado|encontrado|cadastrado)|invalid)/i.test(resultado.faultstring);
    if (erroClienteNaoExiste && clienteBase44) {
        const exp = await exportarClienteSeNecessario(base44, clienteBase44);
        if (exp.ok) {
            await sleep(1500); // Omie indexar
            clientePayload = { codigo_cliente_integracao: String(clienteBase44.id) };
            const payload2 = montarPayloadPedido({ pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente });
            resultado = await omieCall(base44, "IncluirPedido", payload2);
        } else {
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: `Cliente não estava no Omie: ${exp.erro}`, omie_enviado: false });
            return { sucesso: false, erro: `Cliente não estava no Omie: ${exp.erro}`, pedido_id };
        }
    }

    // Idempotência otimizada: se já existe, altera direto sem consulta preventiva
    if (resultado?.faultstring && /(já cadastrado|já existe|código.*cadastrado|codigo.*cadastrado)/i.test(resultado.faultstring)) {
        resultado = await omieCall(base44, "AlterarPedidoVenda", payload);
    }

    // REDUNDANT: Omie retorna erro de "consumo redundante" quando a mesma chamada
    // é feita em intervalo curto. Se isso acontece, o pedido PODE já ter sido criado
    // com sucesso na tentativa anterior. Consultar no Omie antes de marcar como erro.
    if (resultado?.faultstring && /redundan/i.test(resultado.faultstring)) {
        debugLog(base44, `[enviarPedidoOmie] REDUNDANT detectado — consultando Omie para verificar se pedido foi criado`, { pedido_id });
        try {
            const consulta = await omieCall(base44, "ConsultarPedido", {
                codigo_pedido_integracao: pedido.id
            }, { maxTentativas: 2 });
            if (consulta?.pedido_venda_produto?.cabecalho?.codigo_pedido) {
                // Pedido existe no Omie — tratar como sucesso
                resultado = {
                    codigo_pedido: consulta.pedido_venda_produto.cabecalho.codigo_pedido,
                    numero_pedido: consulta.pedido_venda_produto.cabecalho.numero_pedido
                };
                debugLog(base44, `[enviarPedidoOmie] REDUNDANT resolvido: pedido encontrado no Omie com código ${resultado.codigo_pedido}`, { pedido_id, codigo_omie: resultado.codigo_pedido });
            }
        } catch (consultaErr) {
            debugLog(base44, `[enviarPedidoOmie] Falha ao consultar pedido após REDUNDANT: ${consultaErr.message}`, { pedido_id, erro: consultaErr.message });
            // Se a consulta falhou, manter o erro original mas verificar se o pedido
            // já tem código Omie salvo localmente (de tentativa anterior)
            const pedidoAtual = await base44.asServiceRole.entities.Pedido.get(pedido_id).catch(() => null);
            if (pedidoAtual?.omie_codigo_pedido) {
                resultado = {
                    codigo_pedido: pedidoAtual.omie_codigo_pedido,
                    numero_pedido: pedidoAtual.numero_pedido
                };
                debugLog(base44, `[enviarPedidoOmie] REDUNDANT resolvido via registro local: código Omie ${resultado.codigo_pedido}`, { pedido_id });
            }
        }
    }

    if (resultado?.faultstring) {
        debugLog(base44, `[enviarPedidoOmie] Erro Omie: ${resultado.faultstring}`, { pedido_id, erro: resultado.faultstring, faultcode: resultado.faultcode });
        // Se o pedido já tem código Omie salvo, não marcar omie_enviado como false
        const pedidoAtual = await base44.asServiceRole.entities.Pedido.get(pedido_id).catch(() => null);
        if (pedidoAtual?.omie_codigo_pedido) {
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: resultado.faultstring, omie_enviado: true });
            return { sucesso: true, pedido_id, codigo_pedido_omie: pedidoAtual.omie_codigo_pedido, numero_pedido_omie: pedidoAtual.numero_pedido, mensagem: `Pedido já existia no Omie (erro ignorado: ${resultado.faultstring})`, duracao_ms: Date.now() - t0 };
        }
        await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: resultado.faultstring, omie_enviado: false });
        return { sucesso: false, erro: resultado.faultstring, pedido_id, duracao_ms: Date.now() - t0 };
    }

    const codigoOmie = resultado.codigo_pedido || resultado.codigo_pedido_omie || null;
    const numeroPedidoOmie = resultado.numero_pedido || resultado.numero_pedido_omie || null;

    const updateData = {
        omie_codigo_pedido: codigoOmie != null ? String(codigoOmie) : null,
        omie_enviado: true,
        omie_erro: null,
        status: pedido.status === 'pendente' ? 'enviado' : pedido.status,
        data_envio: pedido.data_envio || new Date().toISOString()
    };
    if (numeroPedidoOmie) {
        updateData.numero_pedido = String(numeroPedidoOmie);
        // Atualizar dados_adicionais_nf local com o número do pedido (sem chamada extra ao Omie — economia de 1 req/pedido)
        const dadosAtuais = pedido.dados_adicionais_nf || '';
        const semPrefixo = dadosAtuais.replace(/^Pedido Nº: .+?(\s*\|\s*|$)/, '').trim();
        const partes = [`Pedido Nº: ${numeroPedidoOmie}`];
        if (semPrefixo) partes.push(semPrefixo);
        updateData.dados_adicionais_nf = partes.join(' | ');
    }
    await base44.asServiceRole.entities.Pedido.update(pedido_id, updateData);

    debugLog(base44, `[enviarPedidoOmie] Pedido enviado com sucesso, omie_id: ${codigoOmie}`, { pedido_id, omie_id: codigoOmie, numero_pedido_omie: numeroPedidoOmie });

    console.log(`[PERF] Pedido ${pedido_id}: ${Date.now() - t0}ms | sucesso: true`);
    return { sucesso: true, pedido_id, codigo_pedido_omie: codigoOmie, numero_pedido_omie: numeroPedidoOmie, duracao_ms: Date.now() - t0 };
}

async function processarLotePedidos(base44, pedidosInput) {
    const t0 = Date.now();
    const pedidoIds = pedidosInput
        .map(p => typeof p === 'string' ? p : (p?.id || p?.pedido_id))
        .filter(Boolean);

    const resultados = [];
    const contaCorrentePadrao = await resolverContaCorrentePadrao(base44);

    // IncluirPedido é método de ESCRITA — a Omie aceita apenas 1 por vez.
    // Envio SEQUENCIAL (nunca paralelo) com throttle entre pedidos para respeitar o rate limit.
    let bloqueio425 = null;
    for (const pedido_id of pedidoIds) {
        if (bloqueio425) break;
        try {
            const r = await enviarUmPedido(base44, pedido_id, { contaCorrentePadrao });
            resultados.push(r);
        } catch (err) {
            if (err.code === 'OMIE_425') {
                bloqueio425 = err; // para o lote — API bloqueada
                resultados.push({ sucesso: false, erro: err.message, pedido_id, omie_bloqueada: true });
                break;
            }
            resultados.push({ sucesso: false, erro: err.message, pedido_id });
        }
        await sleep(400); // ~2,5 req/s entre pedidos (margem segura sob 240 req/min)
    }
    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso).length;

    console.log(`[PERF] Lote concluído: ${pedidoIds.length} pedidos em ${Date.now() - t0}ms. Sucessos: ${sucessos}. Erros: ${erros}.`);

    return {
        sucesso: true,
        total: pedidoIds.length,
        sucessos,
        erros,
        omie_bloqueada: !!bloqueio425,
        bloqueado_ate: bloqueio425?.bloqueado_ate || null,
        resultados
    };
}

// ============================================================
// ENTRY POINT HTTP — pedido único ou lote { pedidos: [...] }
// ============================================================
Deno.serve(async (req) => {
    let base44 = null;
    let pedido_id = null;
    try {
        base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        if (user.role !== 'admin') {
            const allVendedores = await base44.asServiceRole.entities.Vendedor.list();
            const vendedor = allVendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
            if (vendedor) {
                const permissoes = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedor.id });
                const perm = permissoes[0];
                if (!perm?.permissoes_pedidos?.enviar_pedido) {
                    return Response.json({ error: 'Sem permissão para enviar pedidos' }, { status: 403 });
                }
            } else {
                return Response.json({ error: 'Funcionário não encontrado' }, { status: 403 });
            }
        }

        const body = await req.json();
        if (Array.isArray(body.pedidos)) {
            if (body.pedidos.length === 0) return Response.json({ error: 'pedidos vazio' }, { status: 400 });
            const r = await processarLotePedidos(base44, body.pedidos);
            return Response.json(r);
        }

        pedido_id = body.pedido_id;
        if (!pedido_id) return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });

        // Aceita ctx pré-carregado do processarFilaEnvioPedidoOmie (evita buscas individuais)
        const ctx = body.ctx || {};
        const r = await enviarUmPedido(base44, pedido_id, ctx);
        return Response.json(r);
    } catch (error) {
        console.error('[enviarPedidoOmie] Erro geral:', error.message);
        const bloqueada = error?.code === 'OMIE_425';
        if (base44 && pedido_id) {
            try {
                // Nunca forçar omie_enviado=false se o pedido já tem código Omie
                const pedCheck = await base44.asServiceRole.entities.Pedido.get(pedido_id).catch(() => null);
                const jaTemCodigo = !!pedCheck?.omie_codigo_pedido;
                await base44.asServiceRole.entities.Pedido.update(pedido_id, {
                    omie_erro: bloqueada ? error.message : `Erro interno: ${error.message}`,
                    omie_enviado: jaTemCodigo ? true : false
                });
            } catch { /* ignore */ }
        }
        return Response.json({ sucesso: false, erro: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});