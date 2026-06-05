import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

// Endpoints Omie:
// - /produtos/pedido/ → ConsultarPedido (consulta dados do pedido)
// - /produtos/pedidovendafat/ → CancelarPedidoVenda (cancela NF faturada)
const OMIE_URL_PEDIDO = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_URL_FAT = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';

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
// Roteia ConsultarPedido para /produtos/pedido/ e demais (CancelarPedidoVenda) para /produtos/pedidovendafat/.
// ✅ resolverCreds removida

// ✅ omieCall local → wrapper _shared/omieClient
async function omieCall(base44, callOrEndpoint, param, optsOrCall) {
  if (typeof optsOrCall === 'object') return omieCallShared(base44, callOrEndpoint, param, optsOrCall || {});
  if (typeof optsOrCall === 'string') return omieCallShared(base44, callOrEndpoint, param, { call: optsOrCall });
  return omieCallShared(base44, 'produtos/pedidovendafat/', param, { call: callOrEndpoint });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, motivo = '', origem = 'manual' } = body;
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });

    let status = 'cancelado';
    let erroOmie = null;
    let numeroNf = '';
    let valorNf = 0;
    let clienteNome = '';

    try {
      const consulta = await omieCall(base44, 'ConsultarPedido', { codigo_pedido: Number(codigo_pedido) });
      const pedido = consulta.pedido_venda_produto;
      numeroNf = pedido?.informacoes_adicionais?.numero_nfe || '';
      valorNf = pedido?.total_pedido?.valor_total_pedido || 0;
      clienteNome = pedido?.cabecalho?.codigo_cliente || '';
    } catch (_) { /* ignore */ }

    // CancelarPedidoVenda fica em /produtos/pedidovendafat/ (endpoint de faturamento)
    try {
      await omieCall(base44, 'CancelarPedidoVenda', {
        nCodPed: Number(codigo_pedido),
        cJustCanc: motivo || `Cancelamento via ${origem}`
      });
    } catch (err) {
      if (err.code === 'OMIE_425') throw err; // propaga bloqueio ao catch externo
      const msg = err.message.toLowerCase();
      if (msg.includes('já') || msg.includes('ja cancelado') || msg.includes('cancelado')) {
        status = 'ja_cancelado';
      } else {
        status = 'erro';
        erroOmie = err.message;
      }
    }

    const registro = await base44.asServiceRole.entities.Cancelamento.create({
      pedido_codigo_omie: String(codigo_pedido),
      numero_nf: String(numeroNf),
      valor_nf: Number(valorNf) || 0,
      cliente_nome: String(clienteNome),
      data_cancelamento: new Date().toISOString(),
      motivo,
      origem,
      funcionario_nome: user.full_name || user.email,
      status,
      erro_omie: erroOmie
    });

    if (status !== 'erro') {
      // 1. Atualiza o Pedido local
      const pedidosLocais = await base44.asServiceRole.entities.Pedido
        .filter({ omie_codigo_pedido: String(codigo_pedido) }, '-updated_date', 1)
        .catch(() => []);
      const pedidoLocal = pedidosLocais?.[0];
      if (pedidoLocal?.id) {
        await base44.asServiceRole.entities.Pedido.update(pedidoLocal.id, {
          status: 'cancelado',
          data_cancelamento: new Date().toISOString(),
          cancelado_por: origem,
          cancelado_por_nome: user.full_name || user.email
        }).catch(() => {});
      }

      // 2. Atualiza o espelho PedidoLiberadoOmie
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie
        .filter({ codigo_pedido: String(codigo_pedido) }, '-updated_date', 1)
        .catch(() => []);
      const espelho = espelhos?.[0];
      if (espelho?.id) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelho.id, {
          status_real: 'cancelada',
          etapa: '80'
        }).catch(() => {});
      }

      // 3. Atualiza o snapshot da carga (se o pedido tiver carga_id)
      const cargaId = pedidoLocal?.carga_id;
      if (cargaId) {
        const carga = await base44.asServiceRole.entities.Carga.get(cargaId).catch(() => null);
        if (carga) {
          const novosPedidos = (carga.pedidos_omie || []).map(p =>
            String(p.codigo_pedido) === String(codigo_pedido)
              ? { ...p, cancelado: true, numero_nf: p.numero_nf || '' }
              : p
          );
          await base44.asServiceRole.entities.Carga.update(cargaId, {
            pedidos_omie: novosPedidos
          }).catch(() => {});
        }
      }
    }

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedidovendafat',
      call: 'CancelarPedidoVenda',
      operacao: `cancelar_${origem}`,
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: status === 'erro' ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({ sucesso: status !== 'erro', status, registro_id: registro.id, erro: erroOmie });
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});