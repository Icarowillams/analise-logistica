import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Solta/reabre uma carga: libera todos os pedidos de volta para Montagem de Carga.
// body: { carga_id: string, motivo?: string }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { carga_id, motivo = '' } = body;

    if (!carga_id) return Response.json({ error: 'carga_id obrigatório' }, { status: 400 });

    const carga = await base44.asServiceRole.entities.Carga.get(carga_id);
    if (!carga) return Response.json({ error: 'Carga não encontrada' }, { status: 404 });

    // Bloqueia se em processamento Omie ativo
    const procStatus = carga.processamento_omie_status;
    if (procStatus === 'em_andamento') {
      return Response.json({ error: 'Carga está em processamento Omie. Aguarde a conclusão antes de soltar.' }, { status: 400 });
    }

    const pedidosOmie = carga.pedidos_omie || [];
    const pedidosInternos = carga.pedidos_internos || [];
    const pedidosTroca = carga.pedidos_troca || [];
    const totalPedidos = pedidosOmie.length + pedidosInternos.length + pedidosTroca.length;

    // Verifica se há pedidos já na etapa 50+ no Omie (faturada = status local)
    const temPedidoFaturado = carga.status_carga === 'faturada';

    // Libera pedidos Omie — solta carga_id
    let pedidosLiberados = 0;
    for (const p of pedidosOmie) {
      try {
        let pedidoId = p.pedido_id;
        if (!pedidoId && p.codigo_pedido) {
          const locais = await base44.asServiceRole.entities.Pedido.filter(
            { omie_codigo_pedido: String(p.codigo_pedido) }, '-created_date', 1
          );
          pedidoId = locais?.[0]?.id;
        }
        if (pedidoId) {
          await base44.asServiceRole.entities.Pedido.update(pedidoId, {
            carga_id: null,
            numero_carga: null,
            status: 'liberado',
            status_logistico: 'aguardando',
            etapa: 'faturamento'
          });
          pedidosLiberados++;
        }

        // Atualiza imediatamente o espelho PedidoLiberadoOmie de volta para etapa Liberados (20),
        // para o pedido reaparecer na Montagem de Carga sem esperar a reconciliação do Omie.
        if (p.codigo_pedido) {
          const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
            { codigo_pedido: String(p.codigo_pedido) }, '-updated_date', 1
          ).catch(() => []);
          if (espelhos?.[0]) {
            await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
              etapa: '20',
              status_label: 'Liberado',
              origem_sync: 'reconciliacao',
              sincronizado_em: new Date().toISOString()
            }).catch((e) => console.warn('Falha ao atualizar espelho:', e.message));
          }
        }
      } catch (e) { console.warn('Falha ao liberar pedido Omie:', e.message); }
    }

    // Libera pedidos internos D1
    for (const p of pedidosInternos) {
      try {
        if (p.pedido_id) {
          await base44.asServiceRole.entities.Pedido.update(p.pedido_id, {
            carga_id: null,
            numero_carga: null,
            status: 'pendente',
            status_logistico: 'aguardando',
            etapa: 'comercial'
          });
          pedidosLiberados++;
        }
      } catch (e) { console.warn('Falha ao liberar pedido interno:', e.message); }
    }

    // Libera trocas
    for (const t of pedidosTroca) {
      try {
        if (t.pedido_troca_id) {
          await base44.asServiceRole.entities.PedidoTroca.update(t.pedido_troca_id, {
            carga_id: null, motorista_id: null, status: 'aprovado'
          });
        }
        let pedidoTrocaId = t.pedido_id;
        if (!pedidoTrocaId && t.numero_pedido) {
          const locais = await base44.asServiceRole.entities.Pedido.filter(
            { numero_pedido: t.numero_pedido, tipo: 'troca' }, '-created_date', 1
          );
          pedidoTrocaId = locais?.[0]?.id;
        }
        if (pedidoTrocaId) {
          await base44.asServiceRole.entities.Pedido.update(pedidoTrocaId, {
            carga_id: null, numero_carga: null, status: 'liberado',
            status_logistico: 'aguardando', etapa: 'faturamento'
          });
          pedidosLiberados++;
        }
      } catch (e) { console.warn('Falha ao liberar troca:', e.message); }
    }

    // Cancela itens da fila pendentes
    const filaItens = await base44.asServiceRole.entities.FilaCargaOmie.filter(
      { carga_id }, '-created_date', 500
    ).catch(() => []);
    for (const item of filaItens) {
      if (['pendente', 'processando'].includes(item.status)) {
        await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
          status: 'erro', erro_log: 'Cancelado: carga solta pelo usuário'
        }).catch(() => {});
      }
    }

    // Limpa a carga (zera pedidos e totais) mas mantém o registro
    await base44.asServiceRole.entities.Carga.update(carga_id, {
      pedidos_omie: [],
      pedidos_internos: [],
      pedidos_troca: [],
      quantidade_pedidos: 0,
      quantidade_clientes: 0,
      valor_total: 0,
      valor_total_carga: 0,
      peso_total_kg: 0,
      volume_total_m3: 0,
      produtos_resumo: [],
      status_carga: 'montagem',
      processamento_omie_status: 'nao_iniciado',
      processamento_omie_total: 0,
      observacao: `Carga solta em ${new Date().toISOString()}. Motivo: ${motivo || 'Não informado'}. ${carga.observacao || ''}`
    });

    // Log gerencial
    await base44.asServiceRole.entities.LogGerencial.create({
      tipo_acao: 'soltar_carga',
      entidade_tipo: 'Carga',
      entidade_id: carga_id,
      carga_id,
      entidade_descricao: `Carga ${carga.numero_carga}`,
      usuario_email: user.email,
      usuario_nome: user.full_name || user.email,
      descricao: `Carga ${carga.numero_carga} solta. ${pedidosLiberados} pedido(s) liberado(s). Motivo: ${motivo || 'Não informado'}`,
      origem: 'frontend'
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      pedidos_liberados: pedidosLiberados,
      total_pedidos: totalPedidos,
      tinha_pedido_faturado: temPedidoFaturado,
      mensagem: `Carga ${carga.numero_carga} solta com sucesso. ${pedidosLiberados} pedido(s) liberado(s) para Montagem.`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});