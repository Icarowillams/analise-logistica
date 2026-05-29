import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PEDIDOS_PADRAO = ['344', '345', '346', '326', '325', '327', '329', '330', '333', '332', '328', '331', '317', '316', '296', '295', '294', '293', '287', '283', '282', '281', '247'];

function normalizarNumero(valor) {
  return String(valor || '').replace(/\D/g, '').replace(/^0+/, '') || String(valor || '').trim();
}

function encontrarPedidoPrincipal(pedidos, chave) {
  const chaveTexto = String(chave || '').trim();
  const chaveNormalizada = normalizarNumero(chaveTexto);
  return pedidos.find((pedido) =>
    pedido.id === chaveTexto ||
    String(pedido.numero_pedido || '') === chaveTexto ||
    normalizarNumero(pedido.numero_pedido) === chaveNormalizada ||
    String(pedido.omie_codigo_pedido || '') === chaveTexto
  );
}

function encontrarPedidoLiberado(registros, pedido, chave) {
  const numeroNormalizado = normalizarNumero(pedido?.numero_pedido || chave);
  const codigoOmie = String(pedido?.omie_codigo_pedido || '');
  return registros.filter((registro) =>
    registro.pedido_id === pedido?.id ||
    registro.pedido_id === String(chave) ||
    registro.id === String(chave) ||
    String(registro.numero_pedido || '') === String(pedido?.numero_pedido || '') ||
    normalizarNumero(registro.numero_pedido) === numeroNormalizado ||
    String(registro.codigo_pedido || '') === codigoOmie ||
    String(registro.omie_codigo_pedido || '') === codigoOmie ||
    String(registro.codigo_pedido || '') === String(chave)
  );
}

function primeiroValor(registros, campos) {
  for (const registro of registros) {
    for (const campo of campos) {
      if (registro?.[campo] !== undefined && registro?.[campo] !== null && registro?.[campo] !== '') {
        return registro[campo];
      }
    }
  }
  return '';
}

function estaCancelado(valor) {
  const texto = String(valor || '').toLowerCase();
  return ['cancelado', 'cancelada', 's', 'sim', 'true'].includes(texto) || texto.includes('cancelad');
}

function descreverObservacao(pedido, liberados) {
  if (!pedido) return 'Pedido principal não encontrado na entidade Pedido.';
  if (liberados.length === 0) return 'SEM REGISTRO EM PedidoLiberadoOmie.';

  const statusPrincipal = pedido.status || '';
  const statusLiberado = primeiroValor(liberados, ['status', 'status_real', 'status_label']);
  const etapaLiberado = primeiroValor(liberados, ['etapa', 'etapa_omie']);
  const canceladoLiberado = primeiroValor(liberados, ['cancelado', 'situacao']);

  if (estaCancelado(statusLiberado) || estaCancelado(canceladoLiberado) || estaCancelado(etapaLiberado)) {
    return `DIVERGÊNCIA CRÍTICA: Pedido principal está '${statusPrincipal}', mas PedidoLiberadoOmie indica cancelamento/status cancelado. Isso pode explicar a tela mostrando CANCELADO se ela usa PedidoLiberadoOmie.`;
  }

  if (statusPrincipal && statusLiberado && String(statusPrincipal).toLowerCase() !== String(statusLiberado).toLowerCase()) {
    return `Divergência: Pedido.status='${statusPrincipal}' e PedidoLiberadoOmie.status/status_real='${statusLiberado}'.`;
  }

  if (statusPrincipal === 'faturado' && String(etapaLiberado) === '60') {
    return 'Sem divergência crítica: Pedido está faturado e PedidoLiberadoOmie está na etapa 60.';
  }

  return 'Registro encontrado em PedidoLiberadoOmie; revisar campos completos para confirmar influência na interface.';
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

    const [pedidosPrincipais, pedidosLiberados] = await Promise.all([
      base44.asServiceRole.entities.Pedido.list('-created_date', 5000),
      base44.asServiceRole.entities.PedidoLiberadoOmie.list('-created_date', 5000)
    ]);

    const detalhes = [];
    const resumoParaGestor = [];
    const semRegistro = [];
    const comRegistro = [];

    for (const chave of idsSolicitados) {
      const pedido = encontrarPedidoPrincipal(pedidosPrincipais, chave);
      const liberados = encontrarPedidoLiberado(pedidosLiberados, pedido, chave);
      const observacao = descreverObservacao(pedido, liberados);
      const statusLiberado = primeiroValor(liberados, ['status', 'status_real', 'status_label']);
      const canceladoLiberado = primeiroValor(liberados, ['cancelado', 'situacao']);
      const motivoCancelamentoLiberado = primeiroValor(liberados, ['motivo_cancelamento', 'motivo_cancelamento_pedido_liberado']);

      if (liberados.length > 0) comRegistro.push(chave);
      else semRegistro.push(chave);

      detalhes.push({
        pedido_id: pedido?.id || String(chave),
        id_solicitado: String(chave),
        numero_pedido: pedido?.numero_pedido || '',
        status_principal: pedido?.status || 'PEDIDO PRINCIPAL NÃO ENCONTRADO',
        status_pedido_liberado: statusLiberado || 'SEM REGISTRO EM PedidoLiberadoOmie',
        cancelado_pedido_liberado: canceladoLiberado || '',
        motivo_cancelamento_pedido_liberado: motivoCancelamentoLiberado || '',
        observacao,
        pedido_principal_completo: pedido || null,
        pedido_liberado_omie_registros_completos: liberados
      });

      resumoParaGestor.push({
        ID: String(chave),
        'Nº Pedido': pedido?.numero_pedido || '-',
        'Status Pedido': pedido?.status || 'NÃO ENCONTRADO',
        'Status PedidoLiberadoOmie': statusLiberado || 'SEM REGISTRO',
        'Cancelado?': canceladoLiberado || (liberados.length ? 'não informado' : '-'),
        'Observação': observacao
      });
    }

    const frontendAudit = {
      conclusao: 'A tela pages/Pedidos usa PedidoLiberadoOmie como fonte principal. A tela GerenciarPedidos usa Pedido.status para a coluna Status.',
      arquivos_verificados: [
        {
          arquivo: 'pages/Pedidos.jsx',
          achado: 'Renderiza PedidosOmieConsulta; não lê Pedido.status diretamente.'
        },
        {
          arquivo: 'components/pedidosOmie/PedidosOmieConsulta.jsx',
          achado: 'Lê base44.entities.PedidoLiberadoOmie.list(...) e calcula is_cancelado por etapa === cancelado ou status_real === cancelada; exibe badge Cancelado a partir desse espelho.'
        },
        {
          arquivo: 'components/Pedidos/GerenciarPedidos.jsx',
          achado: 'Lê base44.entities.Pedido.list(...) e filtra/exibe status usando p.status da entidade Pedido.'
        },
        {
          arquivo: 'components/Pedidos/PedidoCellRenderer.jsx',
          achado: 'Na coluna status usa STATUS_LABELS[p.status], ou seja, Pedido.status quando recebe pedidos da entidade Pedido.'
        }
      ]
    };

    await base44.asServiceRole.entities.LogGerencial.create({
      tipo_acao: 'outro',
      entidade_tipo: 'PedidoLiberadoOmie',
      entidade_id: 'auditoria_pedido_liberado_omie',
      usuario_email: user.email,
      usuario_nome: user.full_name || user.email,
      descricao: `Auditoria PedidoLiberadoOmie de ${idsSolicitados.length} pedidos: ${comRegistro.length} com registro, ${semRegistro.length} sem registro.`,
      dados_json: JSON.stringify({
        acao: 'auditoria_pedido_liberado_omie',
        ids_solicitados: idsSolicitados,
        total_com_pedido_liberado: comRegistro.length,
        total_sem_pedido_liberado: semRegistro.length,
        frontend_conclusao: frontendAudit.conclusao
      }),
      origem: 'backend'
    });

    return Response.json({
      sucesso: true,
      modo: 'somente_leitura',
      total_pedidos_analisados: idsSolicitados.length,
      total_com_pedido_liberado: comRegistro.length,
      total_sem_pedido_liberado: semRegistro.length,
      pedidos_sem_registro_em_pedido_liberado_omie: semRegistro,
      resumo_para_gestor: resumoParaGestor,
      auditoria_frontend: frontendAudit,
      detalhes
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});