import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Re-tenta uma operação idempotente com backoff. Só re-tenta em erros transitórios
// (429 / 500 / timeout / network). Erros "definitivos" (404, validação) sobem na hora.
async function comRetry(fn, tentativas = 3) {
  const backoff = [400, 800, 1200];
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimoErro = e;
      const msg = String(e?.message || e).toLowerCase();
      const status = e?.status || e?.response?.status;
      const transitorio =
        status === 429 || status === 500 || status === 503 ||
        msg.includes('429') || msg.includes('rate') ||
        msg.includes('timeout') || msg.includes('timed out') ||
        msg.includes('network') || msg.includes('fetch') ||
        msg.includes('econn') || msg.includes('socket');
      if (!transitorio || i === tentativas - 1) throw e;
      await new Promise((r) => setTimeout(r, backoff[i] || 1200));
    }
  }
  throw ultimoErro;
}

// Processa itens em lotes paralelos pequenos (chunk=3) com pausa entre lotes,
// reduzindo concorrência e rate limit (429) em cargas grandes (20+ pedidos).
// Nenhuma rejeição individual aborta o loop — falhas são acumuladas pelo worker.
async function emLotes(itens, worker, tamanho = 3, pausaMs = 150) {
  for (let i = 0; i < itens.length; i += tamanho) {
    const chunk = itens.slice(i, i + tamanho);
    await Promise.allSettled(chunk.map((item) => worker(item)));
    if (i + tamanho < itens.length) {
      await new Promise((r) => setTimeout(r, pausaMs));
    }
  }
}

// Solta/reabre uma carga: libera todos os pedidos de volta para Montagem de Carga.
// À PROVA DE ERRO TOTAL: a carga SEMPRE solta. Erros de item viram erros[] (sucesso=true);
// só erros estruturais (carga não encontrada / body inválido) retornam 500.
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
    if (carga.processamento_omie_status === 'em_andamento') {
      return Response.json({ error: 'Carga está em processamento Omie. Aguarde a conclusão antes de soltar.' }, { status: 400 });
    }

    const pedidosOmie = carga.pedidos_omie || [];
    const pedidosInternos = carga.pedidos_internos || [];
    const pedidosTroca = carga.pedidos_troca || [];
    const totalPedidos = pedidosOmie.length + pedidosInternos.length + pedidosTroca.length;
    const temPedidoFaturado = carga.status_carga === 'faturada';

    // Idempotência: carga já vazia + montagem → já está solta, não reprocessa.
    if (totalPedidos === 0 && carga.status_carga === 'montagem') {
      return Response.json({
        sucesso: true,
        ja_solta: true,
        pedidos_liberados: 0,
        total_pedidos: 0,
        falhas: 0,
        detalhe_falhas: [],
        mensagem: `Carga ${carga.numero_carga} já está solta.`
      });
    }

    const LIBERADO = {
      carga_id: null,
      numero_carga: null,
      status: 'liberado',
      status_logistico: 'aguardando',
      etapa: 'faturamento'
    };

    let pedidosLiberados = 0;
    const erros = [];
    const codigosEspelho = []; // para o passo best-effort do espelho (após zerar)

    // ── PRIORIDADE 1: liberar pedidos Omie ──
    await emLotes(pedidosOmie, async (p) => {
      try {
        let pedidoId = p.pedido_id;
        if (!pedidoId && p.codigo_pedido) {
          const locais = await comRetry(() => base44.asServiceRole.entities.Pedido.filter(
            { omie_codigo_pedido: String(p.codigo_pedido) }, '-created_date', 1
          ));
          pedidoId = locais?.[0]?.id;
        }
        if (pedidoId) {
          await comRetry(() => base44.asServiceRole.entities.Pedido.update(pedidoId, LIBERADO));
          pedidosLiberados++;
        }
        if (p.codigo_pedido) codigosEspelho.push(String(p.codigo_pedido));
      } catch (e) {
        erros.push({ tipo: 'omie', ref: p.codigo_pedido || p.pedido_id, erro: e.message });
        console.warn('Falha ao liberar pedido Omie:', e.message);
      }
    });

    // ── PRIORIDADE 1: liberar pedidos internos D1 (mesmo destino que vendas) ──
    await emLotes(pedidosInternos, async (p) => {
      try {
        if (p.pedido_id) {
          await comRetry(() => base44.asServiceRole.entities.Pedido.update(p.pedido_id, LIBERADO));
          pedidosLiberados++;
        }
      } catch (e) {
        erros.push({ tipo: 'interno', ref: p.pedido_id, erro: e.message });
        console.warn('Falha ao liberar pedido interno:', e.message);
      }
    });

    // ── PRIORIDADE 1: liberar trocas ──
    await emLotes(pedidosTroca, async (t) => {
      try {
        if (t.pedido_troca_id) {
          await comRetry(() => base44.asServiceRole.entities.PedidoTroca.update(t.pedido_troca_id, {
            carga_id: null, motorista_id: null, status: 'aprovado'
          })).catch((e) => console.warn('Falha PedidoTroca:', e.message));
        }
        let pedidoTrocaId = t.pedido_id;
        if (!pedidoTrocaId && t.numero_pedido) {
          const locais = await comRetry(() => base44.asServiceRole.entities.Pedido.filter(
            { numero_pedido: t.numero_pedido, tipo: 'troca' }, '-created_date', 1
          ));
          pedidoTrocaId = locais?.[0]?.id;
        }
        if (pedidoTrocaId) {
          await comRetry(() => base44.asServiceRole.entities.Pedido.update(pedidoTrocaId, LIBERADO));
          pedidosLiberados++;
        }
      } catch (e) {
        erros.push({ tipo: 'troca', ref: t.numero_pedido || t.pedido_troca_id, erro: e.message });
        console.warn('Falha ao liberar troca:', e.message);
      }
    });

    // ── PRIORIDADE MÁXIMA: ZERAR A CARGA — blindado, NUNCA relança ──
    // Melhor a carga ficar solta e sobrar 1 pedido pra reconciliação do que travar cheia.
    let cargaZerada = false;
    try {
      await comRetry(() => base44.asServiceRole.entities.Carga.update(carga_id, {
        pedidos_omie: [],
        pedidos_internos: [],
        pedidos_troca: [],
        quantidade_pedidos: 0,
        quantidade_clientes: 0,
        valor_total: 0,
        valor_total_carga: 0,
        peso_total_kg: 0,
        volume_total_m3: 0,
        quantidade_total_pacotes: 0,
        produtos_resumo: [],
        notas_fiscais: [],
        status_carga: 'montagem',
        processamento_omie_status: 'nao_iniciado',
        processamento_omie_total: 0,
        observacao: `Carga solta em ${new Date().toISOString()}. Motivo: ${motivo || 'Não informado'}. ${carga.observacao || ''}`
      }));
      cargaZerada = true;
    } catch (e) {
      console.warn('Falha ao zerar carga, tentando fallback mínimo:', e.message);
      erros.push({ tipo: 'zerar_carga', ref: carga_id, erro: e.message });
      // Fallback mínimo: ao menos marca montagem pra não travar cheia.
      try {
        await comRetry(() => base44.asServiceRole.entities.Carga.update(carga_id, {
          status_carga: 'montagem',
          processamento_omie_status: 'nao_iniciado'
        }));
        cargaZerada = true;
      } catch (e2) {
        console.warn('Falha no fallback de zeramento:', e2.message);
        erros.push({ tipo: 'zerar_carga_fallback', ref: carga_id, erro: e2.message });
      }
    }

    // ── BEST-EFFORT: cancelar itens da fila pendentes ──
    try {
      const filaItens = await base44.asServiceRole.entities.FilaCargaOmie.filter(
        { carga_id }, '-created_date', 500
      ).catch(() => []);
      const filaPendentes = filaItens.filter((i) => ['pendente', 'processando'].includes(i.status));
      await emLotes(filaPendentes, async (item) => {
        await base44.asServiceRole.entities.FilaCargaOmie.update(item.id, {
          status: 'erro', erro_log: 'Cancelado: carga solta pelo usuário'
        }).catch(() => {});
      });
    } catch (e) {
      console.warn('Falha ao cancelar fila (best-effort):', e.message);
    }

    // ── BEST-EFFORT: atualizar espelho PedidoLiberadoOmie de volta p/ etapa 20 ──
    await emLotes(codigosEspelho, async (codigo) => {
      try {
        const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
          { codigo_pedido: codigo }, '-updated_date', 1
        );
        if (espelhos?.[0]) {
          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
            etapa: '20',
            status_label: 'Liberado',
            origem_sync: 'reconciliacao',
            sincronizado_em: new Date().toISOString()
          });
        }
      } catch (e) {
        console.warn('Falha ao atualizar espelho (best-effort):', e.message);
      }
    });

    // Log gerencial (best-effort)
    await base44.asServiceRole.entities.LogGerencial.create({
      tipo_acao: 'soltar_carga',
      entidade_tipo: 'Carga',
      entidade_id: carga_id,
      carga_id,
      entidade_descricao: `Carga ${carga.numero_carga}`,
      usuario_email: user.email,
      usuario_nome: user.full_name || user.email,
      descricao: `Carga ${carga.numero_carga} solta. ${pedidosLiberados} pedido(s) liberado(s). ${erros.length} falha(s). Motivo: ${motivo || 'Não informado'}`,
      origem: 'frontend'
    }).catch(() => {});

    const teveFalha = erros.length > 0;
    return Response.json({
      sucesso: true,
      pedidos_liberados: pedidosLiberados,
      total_pedidos: totalPedidos,
      carga_zerada: cargaZerada,
      falhas: erros.length,
      detalhe_falhas: erros,
      tinha_pedido_faturado: temPedidoFaturado,
      mensagem: teveFalha
        ? `Carga ${carga.numero_carga} solta com ${erros.length} falha(s). ${pedidosLiberados} pedido(s) liberado(s) — pendências serão reconciliadas automaticamente.`
        : `Carga ${carga.numero_carga} solta com sucesso. ${pedidosLiberados} pedido(s) liberado(s) para Montagem.`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});