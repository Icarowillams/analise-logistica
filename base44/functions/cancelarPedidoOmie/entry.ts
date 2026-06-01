import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

// Etapas do Omie para Venda de Produto (operação 11):
// 10 = Pedido de Venda
// 20 = Pedidos Liberados (Separar Estoque)
// 50 = Faturar
// 60 = Faturado
const ETAPAS_CANCELAVEIS = ['10', '20'];

const ETAPA_NOMES = {
    '10': 'Pedido de Venda',
    '20': 'Pedidos Liberados',
    '50': 'Faturar',
    '60': 'Faturado',
};

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  return null;
}
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

async function omieCall(base44, endpoint, param, options = {}) {
  const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
  const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
  const cacheKey = `${endpoint}_${JSON.stringify(param)}`;
  const isReadOnly = /^(Listar|Consultar|Pesquisar|Buscar)/.test(endpoint);
  if (isReadOnly) {
    const cached = getFromMemoryCache(cacheKey);
    if (cached) return cached;
  }
  
  const body = {
    call: endpoint,
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param]
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
  
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://app.omie.com.br/api/v1/geral/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      
      const data = await res.json();
      
      if (!options.skipLog) {
        try {
          await base44.entities.create('LogIntegracaoOmie', {
            endpoint,
            payload_envio: JSON.stringify(param).slice(0, 2000),
            payload_resposta: JSON.stringify(data).slice(0, 2000),
            sucesso: !data.faultcode,
            erro: data.faultstring || null,
            created_date: new Date().toISOString()
          });
        } catch(logErr) { /* silent fail */ }
      }
      if (isReadOnly) setMemoryCache(cacheKey, data);
      
      return data;
    } catch(err) {
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

async function consultarPedidoOmie(base44, codigoPedido) {
    const result = await omieCall(base44, "ConsultarPedido", { codigo_pedido: Number(codigoPedido) }, { skipLog: true });
    console.log('[cancelarPedidoOmie] ConsultarPedido resposta:', JSON.stringify(result).substring(0, 2000));
    return result;
}

async function excluirPedidoOmie(base44, codigoPedido) {
    const result = await omieCall(base44, "ExcluirPedido", { codigo_pedido: Number(codigoPedido) });
    console.log('[cancelarPedidoOmie] ExcluirPedido resposta:', JSON.stringify(result).substring(0, 1000));
    return result;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { pedido_id, motivo } = body;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        if (!motivo || !motivo.trim()) {
            return Response.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 });
        }

        // Buscar pedido no Base44
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        let omieCancelado = false;
        let omieErro = null;
        let etapaAtual = null;
        let etapaNome = null;

        // Se o pedido foi enviado ao Omie, verificar etapa antes de cancelar
        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
            const codigoPedido = Number(pedido.omie_codigo_pedido);
            console.log('[cancelarPedidoOmie] Consultando etapa do pedido Omie:', codigoPedido);

            // 1. Consultar pedido no Omie para verificar a etapa
            const consultaResult = await consultarPedidoOmie(base44, codigoPedido);

            if (!consultaResult) {
                return Response.json({
                    sucesso: false,
                    error: 'Não foi possível consultar o pedido no Omie. Tente novamente.'
                }, { status: 500 });
            }

            // Se o Omie retornou erro (pedido já excluído/não encontrado)
            if (consultaResult.faultstring || consultaResult.faultcode) {
                const faultMsg = (consultaResult.faultstring || '').toLowerCase();
                const jaExcluido = faultMsg.includes('não encontrad') ||
                    faultMsg.includes('nao encontrad') ||
                    faultMsg.includes('excluíd') ||
                    faultMsg.includes('excluid') ||
                    faultMsg.includes('cancelad');

                if (jaExcluido) {
                    // Pedido já não existe no Omie, cancelar apenas localmente
                    console.log('[cancelarPedidoOmie] Pedido já não existe no Omie. Cancelando apenas localmente.');
                    omieCancelado = true;
                } else {
                    return Response.json({
                        sucesso: false,
                        error: `Erro ao consultar pedido no Omie: ${consultaResult.faultstring}`
                    }, { status: 400 });
                }
            } else if (consultaResult.pedido_venda_produto) {
                // Pedido existe no Omie — verificar etapa
                etapaAtual = consultaResult.pedido_venda_produto.cabecalho?.etapa;
                etapaNome = ETAPA_NOMES[etapaAtual] || `Etapa ${etapaAtual}`;
                const canceladoOmie = consultaResult.pedido_venda_produto.infoCadastro?.cancelado;

                console.log(`[cancelarPedidoOmie] Etapa atual: ${etapaAtual} (${etapaNome}), cancelado: ${canceladoOmie}`);

                // Se já está cancelado no Omie
                if (canceladoOmie === 'S') {
                    console.log('[cancelarPedidoOmie] Pedido já está cancelado no Omie.');
                    omieCancelado = true;
                }
                // Verificar se a etapa permite cancelamento
                else if (!ETAPAS_CANCELAVEIS.includes(etapaAtual)) {
                    return Response.json({
                        sucesso: false,
                        error: `Não é possível cancelar este pedido. Ele está na etapa "${etapaNome}" (${etapaAtual}) no Omie. Só é possível cancelar pedidos nas etapas: Pedido de Venda (10) ou Pedidos Liberados (20).`,
                        etapa_atual: etapaAtual,
                        etapa_nome: etapaNome
                    }, { status: 400 });
                }
                else {
                    // Etapa é cancelável — executar exclusão no Omie (API só suporta exclusão)
                    console.log(`[cancelarPedidoOmie] Etapa ${etapaAtual} permite cancelamento. Excluindo no Omie...`);
                    const excluirResult = await excluirPedidoOmie(base44, codigoPedido);

                    if (excluirResult && !excluirResult.faultstring && !excluirResult.faultcode) {
                        omieCancelado = true;
                        console.log('[cancelarPedidoOmie] Pedido excluído com sucesso no Omie!');
                    } else {
                        omieErro = excluirResult?.faultstring || 'Falha ao excluir no Omie';
                        console.error('[cancelarPedidoOmie] Erro ao excluir:', omieErro);
                        // Retornar erro sem cancelar localmente
                        return Response.json({
                            sucesso: false,
                            error: `Erro ao cancelar pedido no Omie: ${omieErro}`,
                            etapa_atual: etapaAtual,
                            etapa_nome: etapaNome
                        }, { status: 400 });
                    }
                }
            }
        }

        // Buscar nome do funcionário pelo email
        let nomeUsuario = user.full_name || user.email;
        try {
            const vendedores = await base44.asServiceRole.entities.Vendedor.filter({ email: user.email });
            if (vendedores.length > 0) {
                nomeUsuario = vendedores[0].nome;
            }
        } catch (e) { /* usa full_name como fallback */ }

        // Atualizar pedido no Base44 como cancelado
        await base44.asServiceRole.entities.Pedido.update(pedido_id, {
            status: 'cancelado',
            cancelado_por: user.email,
            cancelado_por_nome: nomeUsuario,
            data_cancelamento: new Date().toISOString(),
            motivo_cancelamento: motivo.trim(),
            omie_erro: omieErro
        });

        console.log('[cancelarPedidoOmie] Pedido cancelado localmente. Omie excluído:', omieCancelado);

        return Response.json({
            sucesso: true,
            omie_cancelado: omieCancelado,
            etapa_cancelada: etapaAtual,
            etapa_nome: etapaNome,
            mensagem: omieCancelado
                ? `Pedido cancelado com sucesso (etapa: ${etapaNome || 'N/A'})`
                : 'Pedido cancelado no sistema (não estava no Omie)'
        });

    } catch (error) {
        console.error('[cancelarPedidoOmie] Erro geral:', error.message);
        return Response.json({ error: error.message, sucesso: false }, { status: 500 });
    }
});