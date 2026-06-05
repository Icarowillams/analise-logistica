import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  return null;
}
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

// omieCall robusto: circuit breaker + 425 (bloqueio 30min, sem retry) + retry 429 + log padronizado.
// ✅ omieCall local → wrapper _shared/omieClient
async function omieCall(base44, callOrEndpoint, param, optsOrCall) {
  if (typeof optsOrCall === 'object') return omieCallShared(base44, callOrEndpoint, param, optsOrCall || {});
  if (typeof optsOrCall === 'string') return omieCallShared(base44, callOrEndpoint, param, { call: optsOrCall });
  return omieCallShared(base44, 'produtos/pedido/', param, { call: callOrEndpoint });
}

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
      if (err.code === 'OMIE_425') throw err; // propaga bloqueio ao catch externo
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
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});