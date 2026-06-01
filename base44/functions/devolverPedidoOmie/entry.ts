import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

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

// Devolve itens de um pedido Omie (parcial ou total)
// body: { codigo_pedido, produtos: [{nCodProd, quantidade, motivo}], tipo_retorno, motivo_geral }
// IMPORTANTE: usa nCodProd (código interno do Omie), NÃO codigo_produto_integracao
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, produtos = [], tipo_retorno = 'devolucao_parcial', motivo_geral = '', carga_id = null } = body;
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });
    if (produtos.length === 0) return Response.json({ error: 'produtos vazio' }, { status: 400 });

    const consulta = await omieCall(base44, 'ConsultarPedido', { codigo_pedido: Number(codigo_pedido) }, { cacheMinutes: 0 });
    const pedido = consulta?.pedido_venda_produto;
    if (!pedido) return Response.json({ error: 'Pedido não encontrado no Omie' }, { status: 404 });

    // Detecção precisa de cancelamento
    const flagCancelado = pedido?.infoCadastro?.cancelado;
    const etapaAtual = String(pedido?.cabecalho?.etapa || '');
    if (flagCancelado === 'S' || etapaAtual === '99') {
      return Response.json({ error: 'Pedido cancelado: não é permitido editar ou ajustar.' }, { status: 400 });
    }

    // Regra: só pode devolver/ajustar pedidos nas etapas 10/20/50 (antes do faturamento).
    const ETAPAS_AJUSTAVEIS = ['10', '20', '50'];
    const ETAPA_NOMES_MAP = { '10': 'Pedido de Venda', '20': 'Liberados (Pendente)', '50': 'Faturar (Montagem)', '60': 'Faturado', '70': 'Entrega' };
    if (!ETAPAS_AJUSTAVEIS.includes(etapaAtual)) {
      const nome = ETAPA_NOMES_MAP[etapaAtual] || `Etapa ${etapaAtual}`;
      return Response.json({
        error: `Não é possível devolver/ajustar este pedido. Está na etapa "${nome}" (${etapaAtual}). Apenas pedidos Pendentes, Liberados ou em Montagem podem ser ajustados.`,
        etapa_atual: etapaAtual, etapa_nome: nome
      }, { status: 400 });
    }

    const produtosDevolver = produtos.map(p => ({
      nCodProd: Number(p.nCodProd || p.codigo_produto),
      nQtde: Number(p.quantidade)
    }));

    let erroOmie = null;
    let nIdDevolucao = null;
    try {
      const resp = await omieCall(base44, 'DevolverPedido', {
        nCodPed: Number(codigo_pedido),
        produtos: produtosDevolver
      }, { cacheMinutes: 0 });
      // Captura nIdDevolucao retornado pelo Omie para rastreio
      nIdDevolucao = resp?.nIdDevolucao || resp?.nCodDevolucao || null;
    } catch (err) {
      erroOmie = err.message;
    }

    // Calcula valor total da devolução
    const valorTotal = produtos.reduce((s, p) => s + (Number(p.valor_unitario || 0) * Number(p.quantidade || 0)), 0);

    const registro = await base44.asServiceRole.entities.Retorno.create({
      pedido_codigo_omie: String(codigo_pedido),
      carga_id,
      data_retorno: new Date().toISOString().slice(0, 10),
      produtos: produtos.map(p => ({
        codigo_produto: String(p.nCodProd || p.codigo_produto),
        descricao: p.descricao || '',
        quantidade: Number(p.quantidade),
        valor_unitario: Number(p.valor_unitario || 0),
        valor_total: Number(p.valor_unitario || 0) * Number(p.quantidade),
        motivo: p.motivo || motivo_geral
      })),
      tipo_retorno,
      valor_total_retorno: valorTotal,
      motivo_geral,
      status: erroOmie ? 'pendente' : 'devolvido_omie',
      observacoes: nIdDevolucao ? `nIdDevolucao Omie: ${nIdDevolucao}` : null
    });

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'DevolverPedido',
      operacao: 'devolver_pedido',
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: erroOmie ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    if (erroOmie) return Response.json({ error: erroOmie, registro_id: registro.id }, { status: 500 });
    return Response.json({ sucesso: true, registro_id: registro.id, valor_total: valorTotal, nIdDevolucao });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});