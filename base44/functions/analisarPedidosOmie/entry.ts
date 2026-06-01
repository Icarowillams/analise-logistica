import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const PEDIDOS_PADRAO = ['344', '345', '346', '326', '325', '327', '329', '330', '333', '332', '328', '331', '317', '316', '296', '295', '294', '293', '287', '283', '282', '281', '247'];
const ETAPA_STATUS = {
  '10': 'pendente',
  '20': 'enviado',
  '50': 'faturado',
  '60': 'faturado',
  '70': 'entregue',
  '80': 'cancelado'
};

function normalizarNumero(valor) {
  return String(valor || '').replace(/\D/g, '').replace(/^0+/, '') || String(valor || '');
}

function encontrarPedido(pedidos, chave) {
  const chaveTexto = String(chave || '').trim();
  const chaveNormalizada = normalizarNumero(chaveTexto);
  return pedidos.find(p =>
    p.id === chaveTexto ||
    String(p.numero_pedido || '') === chaveTexto ||
    normalizarNumero(p.numero_pedido) === chaveNormalizada
  );
}

async function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function consultarPedidoOmie(codigoPedido) {
  const response = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarPedido',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{ codigo_pedido: Number(codigoPedido) }]
    })
  });
  const data = await response.json();
  if (data.faultstring || data.faultcode) {
    throw new Error(data.faultstring || data.faultcode);
  }
  return data.pedido_venda_produto || data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const idsSolicitados = Array.isArray(body.ids) && body.ids.length > 0 ? body.ids.map(String) : PEDIDOS_PADRAO;
    const delayMs = Number(body.delay_ms || 400);
    const todosPedidos = await base44.asServiceRole.entities.Pedido.list('-created_date', 5000);

    const analisados = [];
    const semOmieCodigo = [];
    const pedidosNaoEncontrados = [];
    const divergencias = [];
    const erros_omie = [];
    const etapasEncontradas = {};
    const pedidosJaFaturadosNoOmie = [];

    for (const chave of idsSolicitados) {
      const pedido = encontrarPedido(todosPedidos, chave);
      if (!pedido) {
        pedidosNaoEncontrados.push(String(chave));
        analisados.push({ id_solicitado: String(chave), encontrado: false });
        continue;
      }

      const base = {
        id: pedido.id,
        id_solicitado: String(chave),
        numero_pedido: pedido.numero_pedido || '',
        omie_codigo_pedido: pedido.omie_codigo_pedido || '',
        status_atual_base44: pedido.status || '',
        cliente_nome: pedido.cliente_nome || ''
      };

      if (!pedido.omie_codigo_pedido) {
        semOmieCodigo.push(base);
        analisados.push({ ...base, encontrado: true, sem_omie_codigo: true });
        continue;
      }

      try {
        const pedidoOmie = await consultarPedidoOmie(pedido.omie_codigo_pedido);
        const etapa = String(pedidoOmie?.cabecalho?.etapa || '');
        const statusEsperado = ETAPA_STATUS[etapa] || '';
        const numeroPedidoOmie = pedidoOmie?.cabecalho?.numero_pedido || pedidoOmie?.cabecalho?.numero_pedido_omie || '';
        const codigoPedidoIntegracao = pedidoOmie?.cabecalho?.codigo_pedido_integracao || '';

        if (etapa) etapasEncontradas[etapa] = (etapasEncontradas[etapa] || 0) + 1;

        const registro = {
          ...base,
          encontrado: true,
          etapa_omie: etapa,
          numero_pedido_omie: numeroPedidoOmie,
          codigo_pedido_integracao: codigoPedidoIntegracao,
          status_esperado: statusEsperado,
          divergente: Boolean(statusEsperado && pedido.status !== statusEsperado)
        };

        analisados.push(registro);

        if (['50', '60'].includes(etapa)) {
          pedidosJaFaturadosNoOmie.push({
            id: pedido.id,
            numero_pedido: pedido.numero_pedido || '',
            etapa_omie: etapa,
            status_atual_base44: pedido.status || '',
            cliente_nome: pedido.cliente_nome || ''
          });
        }

        if (registro.divergente) {
          divergencias.push({
            id: pedido.id,
            numero_pedido: pedido.numero_pedido || '',
            status_atual_base44: pedido.status || '',
            etapa_omie: etapa,
            status_esperado: statusEsperado,
            cliente_nome: pedido.cliente_nome || ''
          });
        }
      } catch (error) {
        const erro = { ...base, erro: error.message };
        erros_omie.push(erro);
        analisados.push({ ...erro, encontrado: true, erro_omie: true });
      }

      await esperar(delayMs);
    }

    await base44.asServiceRole.entities.LogGerencial.create({
      tipo_acao: 'outro',
      entidade_tipo: 'Pedido',
      entidade_id: 'analise_pedidos_omie',
      usuario_email: user.email,
      usuario_nome: user.full_name || user.email,
      descricao: `Análise de ${idsSolicitados.length} pedidos solicitados pelo gestor. ${divergencias.length} divergências encontradas.`,
      dados_json: JSON.stringify({
        acao: 'analise_pedidos_omie',
        ids_solicitados: idsSolicitados,
        divergencias: divergencias.length,
        sem_omie_codigo: semOmieCodigo.length,
        pedidos_nao_encontrados: pedidosNaoEncontrados.length,
        erros_omie: erros_omie.length
      }),
      origem: 'backend'
    });

    return Response.json({
      sucesso: true,
      total_pedidos_analisados: analisados.filter(p => p.encontrado).length,
      total_ids_solicitados: idsSolicitados.length,
      pedidos_com_omie_codigo: analisados.filter(p => p.encontrado && p.omie_codigo_pedido).length,
      pedidos_sem_omie_codigo: {
        total: semOmieCodigo.length,
        pedidos: semOmieCodigo
      },
      pedidos_nao_encontrados: pedidosNaoEncontrados,
      divergencias,
      etapas_encontradas: etapasEncontradas,
      pedidos_ja_faturados_no_omie: pedidosJaFaturadosNoOmie,
      erros_omie,
      analisados
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});