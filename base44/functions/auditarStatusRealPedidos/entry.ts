import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const PEDIDOS_PADRAO = ['344', '345', '346', '326', '325', '327', '329', '330', '333', '332', '328', '331', '317', '316', '296', '295', '294', '293', '287', '283', '282', '281', '247'];

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

function camposPossiveisStatus(registro) {
  const resultado = {};
  if (!registro) return resultado;
  for (const [campo, valor] of Object.entries(registro)) {
    const nome = campo.toLowerCase();
    if (
      nome.includes('status') ||
      nome.includes('situacao') ||
      nome.includes('situação') ||
      nome.includes('cancel') ||
      nome.includes('deleted') ||
      nome.includes('delete') ||
      nome.includes('ativo') ||
      nome.includes('fatur') ||
      nome.includes('etapa')
    ) {
      resultado[campo] = valor;
    }
  }
  return resultado;
}

function encontrarRelacionados(lista, pedido) {
  const numeroNormalizado = normalizarNumero(pedido.numero_pedido);
  return (lista || []).filter(item =>
    item.pedido_id === pedido.id ||
    item.id === pedido.pedido_venda_id ||
    item.numero_pedido === pedido.numero_pedido ||
    item.numero_omie === pedido.numero_pedido ||
    normalizarNumero(item.numero_pedido) === numeroNormalizado ||
    normalizarNumero(item.numero_omie) === numeroNormalizado ||
    String(item.codigo_pedido || '') === String(pedido.omie_codigo_pedido || '') ||
    String(item.omie_codigo_pedido || '') === String(pedido.omie_codigo_pedido || '')
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

function descreverDivergencia({ pedido, pedidoVenda, pedidoLiberado, etapaOmie, situacaoOmie, erroOmie }) {
  const alertas = [];
  const statusPrincipal = pedido?.status || '';
  const canceladoCampo = Boolean(pedido?.cancelado || pedido?.data_cancelamento || pedido?.motivo_cancelamento);
  const deletedAt = pedido?.deletedAt || pedido?.deleted_at || pedido?.deleted_date;

  if (statusPrincipal !== 'cancelado') {
    alertas.push(`Campo Pedido.status está '${statusPrincipal || 'vazio'}', não 'cancelado'.`);
  }
  if (canceladoCampo) {
    alertas.push('Há campo/indício de cancelamento no Pedido principal.');
  }
  if (deletedAt) {
    alertas.push('Há deletedAt/deleted_at preenchido, possível soft-delete.');
  }

  const statusVendaDiferente = (pedidoVenda || []).some(v => v.status && v.status !== statusPrincipal);
  if (statusVendaDiferente) {
    alertas.push('PedidoVenda relacionado possui status diferente do Pedido principal.');
  }

  const statusLiberado = (pedidoLiberado || []).some(v => v.status_real || v.status_label || v.etapa);
  if (statusLiberado) {
    alertas.push('PedidoLiberadoOmie possui status/etapa própria que pode influenciar exibição operacional.');
  }

  if (['50', '60'].includes(String(etapaOmie || '')) && statusPrincipal !== 'faturado') {
    alertas.push(`Omie está na etapa ${etapaOmie}, que indica faturado, mas Pedido.status não está faturado.`);
  }

  if (erroOmie) {
    alertas.push(`Erro ao consultar Omie: ${erroOmie}`);
  }

  if (situacaoOmie) {
    alertas.push(`Situação Omie retornada: ${situacaoOmie}.`);
  }

  return alertas.length ? alertas.join(' ') : 'Nenhuma divergência evidente no banco: Pedido.status está faturado e Omie confirma etapa de faturamento.';
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

    const [pedidosPrincipais, pedidosVenda, pedidosLiberados] = await Promise.all([
      base44.asServiceRole.entities.Pedido.list('-created_date', 5000),
      base44.asServiceRole.entities.PedidoVenda.list('-created_date', 5000).catch(() => []),
      base44.asServiceRole.entities.PedidoLiberadoOmie.list('-created_date', 5000).catch(() => [])
    ]);

    const auditoria = [];
    const resumoParaGestor = [];
    const naoEncontrados = [];
    const contagemStatusPrincipal = {};
    const contagemEtapasOmie = {};
    const possiveisExplicacoes = [];

    for (const chave of idsSolicitados) {
      const pedido = encontrarPedido(pedidosPrincipais, chave);
      if (!pedido) {
        naoEncontrados.push(String(chave));
        resumoParaGestor.push({
          id_solicitado: String(chave),
          numero_pedido: '-',
          status_base44_campo_status: 'NÃO ENCONTRADO',
          etapa_omie: '-',
          cancelado: '-',
          observacao: 'Pedido não encontrado na entidade principal Pedido.'
        });
        continue;
      }

      const relacionadosVenda = encontrarRelacionados(pedidosVenda, pedido);
      const relacionadosLiberado = encontrarRelacionados(pedidosLiberados, pedido);
      const ultimosLogs = await base44.asServiceRole.entities.LogGerencial.filter({ pedido_id: pedido.id }, '-created_date', 3).catch(() => []);

      let omie = null;
      let erroOmie = '';
      let etapaOmie = '';
      let situacaoOmie = '';
      let numeroPedidoOmie = '';
      let codigoPedidoIntegracao = '';

      if (pedido.omie_codigo_pedido) {
        try {
          omie = await consultarPedidoOmie(pedido.omie_codigo_pedido);
          etapaOmie = String(omie?.cabecalho?.etapa || '');
          situacaoOmie = omie?.cabecalho?.situacao || omie?.infoCadastro?.cancelado || omie?.situacao || '';
          numeroPedidoOmie = omie?.cabecalho?.numero_pedido || omie?.cabecalho?.numero_pedido_omie || '';
          codigoPedidoIntegracao = omie?.cabecalho?.codigo_pedido_integracao || '';
          if (etapaOmie) contagemEtapasOmie[etapaOmie] = (contagemEtapasOmie[etapaOmie] || 0) + 1;
        } catch (error) {
          erroOmie = error.message;
        }
        await esperar(delayMs);
      }

      const statusPrincipal = pedido.status || '';
      contagemStatusPrincipal[statusPrincipal || 'vazio'] = (contagemStatusPrincipal[statusPrincipal || 'vazio'] || 0) + 1;

      const cancelado = Boolean(
        pedido.cancelado === true ||
        pedido.cancelado === 'S' ||
        pedido.cancelado === 'sim' ||
        pedido.status === 'cancelado' ||
        pedido.data_cancelamento ||
        pedido.motivo_cancelamento
      );
      const deletedAt = pedido.deletedAt || pedido.deleted_at || pedido.deleted_date || '';
      const divergenciaTexto = descreverDivergencia({
        pedido,
        pedidoVenda: relacionadosVenda,
        pedidoLiberado: relacionadosLiberado,
        etapaOmie,
        situacaoOmie,
        erroOmie
      });

      if (divergenciaTexto !== 'Nenhuma divergência evidente no banco: Pedido.status está faturado e Omie confirma etapa de faturamento.') {
        possiveisExplicacoes.push({ pedido_id: pedido.id, numero_pedido: pedido.numero_pedido || '', observacao: divergenciaTexto });
      }

      auditoria.push({
        pedido_id: pedido.id,
        id_solicitado: String(chave),
        numero_pedido: pedido.numero_pedido || '',
        status_principal: statusPrincipal,
        registro_pedido_completo: pedido,
        campos_possiveis_de_status_no_pedido: camposPossiveisStatus(pedido),
        pedido_venda_relacionado: relacionadosVenda.map(v => ({
          id: v.id,
          status: v.status || '',
          numero_pedido: v.numero_pedido || '',
          numero_omie: v.numero_omie || '',
          registro_completo: v,
          campos_possiveis_de_status: camposPossiveisStatus(v)
        })),
        pedido_liberado_omie_relacionado: relacionadosLiberado.map(v => ({
          id: v.id,
          status: v.status || '',
          status_real: v.status_real || '',
          status_label: v.status_label || '',
          etapa: v.etapa || '',
          numero_pedido: v.numero_pedido || '',
          codigo_pedido: v.codigo_pedido || '',
          registro_completo: v,
          campos_possiveis_de_status: camposPossiveisStatus(v)
        })),
        status_pedido_venda: relacionadosVenda.map(v => v.status || '').filter(Boolean),
        status_pedido_liberado: relacionadosLiberado.map(v => v.status_real || v.status_label || v.etapa || '').filter(Boolean),
        omie: {
          etapa: etapaOmie,
          numero_pedido: numeroPedidoOmie,
          codigo_pedido_integracao: codigoPedidoIntegracao,
          situacao: situacaoOmie,
          erro: erroOmie,
          retorno_completo: omie
        },
        etapa_omie: etapaOmie,
        situacao_omie: situacaoOmie,
        cancelado,
        motivo_cancelamento: pedido.motivo_cancelamento || '',
        deletedAt: deletedAt ? { tem_valor: true, valor: deletedAt } : { tem_valor: false, valor: '' },
        ultimos_logs: ultimosLogs.map(log => ({
          id: log.id,
          created_date: log.created_date,
          tipo_acao: log.tipo_acao,
          descricao: log.descricao,
          alteracoes: log.alteracoes || [],
          dados_json: log.dados_json || '',
          usuario_email: log.usuario_email || ''
        })),
        DIVERGENCIA: divergenciaTexto
      });

      resumoParaGestor.push({
        ID: String(chave),
        pedido_id_real: pedido.id,
        numero_pedido: pedido.numero_pedido || '',
        status_base44_campo_status: statusPrincipal,
        etapa_omie: etapaOmie || (erroOmie ? 'ERRO' : '-'),
        cancelado: cancelado ? 'sim' : 'não',
        observacao: divergenciaTexto
      });
    }

    await base44.asServiceRole.entities.LogGerencial.create({
      tipo_acao: 'outro',
      entidade_tipo: 'Pedido',
      entidade_id: 'auditoria_status_real',
      usuario_email: user.email,
      usuario_nome: user.full_name || user.email,
      descricao: `Auditoria de status real de ${idsSolicitados.length} pedidos. Status encontrados: ${JSON.stringify(contagemStatusPrincipal)}.`,
      dados_json: JSON.stringify({
        acao: 'auditoria_status_real',
        ids_solicitados: idsSolicitados,
        contagem_status_principal: contagemStatusPrincipal,
        contagem_etapas_omie: contagemEtapasOmie,
        nao_encontrados: naoEncontrados.length,
        possiveis_explicacoes: possiveisExplicacoes.length
      }),
      origem: 'backend'
    });

    return Response.json({
      sucesso: true,
      total_ids_solicitados: idsSolicitados.length,
      total_encontrados_na_entidade_pedido: auditoria.length,
      nao_encontrados: naoEncontrados,
      resumo_para_gestor: {
        tabela: resumoParaGestor,
        contagem_status_base44_campo_status: contagemStatusPrincipal,
        contagem_etapas_omie: contagemEtapasOmie
      },
      possiveis_explicacoes: possiveisExplicacoes,
      auditoria_detalhada: auditoria
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});