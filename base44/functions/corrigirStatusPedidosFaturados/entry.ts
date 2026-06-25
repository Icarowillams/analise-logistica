import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

// FONTE DE VERDADE (definida pelo operador): FATURADO = etapa 60 OU NF emitida.
// Etapa 50 = conferência/faturar (ainda NÃO faturado) → mapeia para 'montagem'.
// Só etapa 60 é 'faturado'.
const ETAPA_STATUS = {
  '10': 'pendente',
  '20': 'enviado',
  '50': 'montagem',
  '60': 'faturado',
  '70': 'entregue',
  '80': 'cancelado'
};

async function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function consultarPedidoOmie(codigoPedido) {
  const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
  const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
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
  if (response.status >= 500 || response.status === 429 || response.status === 425) {
    const corpo = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`);
  }
  const data = await response.json();
  if (data.faultstring || data.faultcode) {
    throw new Error(data.faultstring || data.faultcode);
  }
  return data.pedido_venda_produto || data;
}

async function registrarLog(base44, user, pedido, statusNovo, etapa, simular) {
  await base44.asServiceRole.entities.LogGerencial.create({
    tipo_acao: 'edicao',
    entidade_tipo: 'Pedido',
    entidade_id: pedido.id,
    pedido_id: pedido.id,
    cliente_id: pedido.cliente_id || '',
    entidade_descricao: `Pedido ${pedido.numero_pedido || pedido.id}`,
    usuario_email: user.email,
    usuario_nome: user.full_name || user.email,
    descricao: `Status corrigido de ${pedido.status || '-'} para ${statusNovo} — reconciliação pós-bug`,
    dados_json: JSON.stringify({
      acao: 'correcao_status_pedido',
      pedido_id: pedido.id,
      numero_pedido: pedido.numero_pedido || '',
      omie_codigo_pedido: pedido.omie_codigo_pedido || '',
      etapa_omie: etapa,
      status_anterior: pedido.status || '',
      status_novo: statusNovo,
      simular
    }),
    origem: 'backend'
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const simular = body.simular !== false;
    const limite = Number(body.limite || 80);
    const delayMs = Number(body.delay_ms || 300);
    const somenteDivergentes = body.somente_divergentes !== false;

    const todosPedidos = await base44.asServiceRole.entities.Pedido.list('-updated_date', 5000);
    const pedidosElegiveis = todosPedidos.filter(p => p.omie_codigo_pedido && (!somenteDivergentes || ['pendente', 'enviado', 'liberado', 'montagem', 'cancelado'].includes(p.status)));
    const pedidos = pedidosElegiveis.slice(0, limite);

    const corrigidos = [];
    const semMudanca = [];
    const erros = [];

    for (const pedido of pedidos) {
      try {
        const pedidoOmie = await consultarPedidoOmie(pedido.omie_codigo_pedido);
        const etapa = String(pedidoOmie?.cabecalho?.etapa || '');
        const cancelado = pedidoOmie?.infoCadastro?.cancelado === 'S' || pedidoOmie?.cabecalho?.cancelado === 'S';
        const statusNovo = cancelado ? 'cancelado' : ETAPA_STATUS[etapa];

        if (!statusNovo) {
          semMudanca.push({ id: pedido.id, numero_pedido: pedido.numero_pedido || '', motivo: `Etapa sem mapeamento: ${etapa}` });
        } else if (pedido.status !== statusNovo) {
          const registro = {
            id: pedido.id,
            numero_pedido: pedido.numero_pedido || '',
            omie_codigo_pedido: pedido.omie_codigo_pedido,
            etapa_omie: etapa,
            status_anterior: pedido.status || '',
            status_novo: statusNovo,
            cliente_nome: pedido.cliente_nome || ''
          };
          corrigidos.push(registro);

          if (!simular) {
            const updates = { status: statusNovo, omie_erro: null };
            if (etapa === '60') {
              updates.faturado = true;
              updates.status_faturamento = 'faturado';
              updates.data_faturamento = pedido.data_faturamento || new Date().toISOString();
              const numeroNf = pedidoOmie?.infoNfe?.nNF || pedidoOmie?.info_nf?.nNF || pedidoOmie?.cabecalho?.numero_nfe;
              if (numeroNf) updates.numero_nota_fiscal = String(numeroNf);
            }
            if (statusNovo === 'cancelado') updates.data_cancelamento = pedido.data_cancelamento || new Date().toISOString();

            await base44.asServiceRole.entities.Pedido.update(pedido.id, updates);
            await registrarLog(base44, user, pedido, statusNovo, etapa, simular);
          }
        } else {
          semMudanca.push({ id: pedido.id, numero_pedido: pedido.numero_pedido || '', status: pedido.status, etapa_omie: etapa });
        }
      } catch (error) {
        erros.push({ id: pedido.id, numero_pedido: pedido.numero_pedido || '', omie_codigo_pedido: pedido.omie_codigo_pedido, erro: error.message });
      }

      await esperar(delayMs);
    }

    return Response.json({
      sucesso: true,
      simular,
      total_elegiveis: pedidosElegiveis.length,
      total_consultados: pedidos.length,
      limite,
      total_corrigidos: corrigidos.length,
      total_sem_mudanca: semMudanca.length,
      total_erros: erros.length,
      corrigidos,
      erros,
      aviso: simular ? 'Simulação apenas: nada foi alterado. Para aplicar, chame com simular=false.' : 'Correções aplicadas.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});