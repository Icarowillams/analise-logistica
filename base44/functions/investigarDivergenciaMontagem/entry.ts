import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 1. Pedidos locais liberados
    const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter(
      { status: 'liberado' }, '-created_date', 500
    );

    // 2. Espelho Omie (etapas 20 e 50)
    const espelho = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('-created_date', 2000);
    const espelhoAtivos = espelho.filter(e => ['20', '50'].includes(String(e.etapa)));

    // 3. Trocas aprovadas
    const trocas = await base44.asServiceRole.entities.PedidoTroca.filter(
      { status: 'aprovado' }, '-created_date', 500
    );

    // 4. Cargas em montagem
    const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 500);
    const cargasAtivas = cargas.filter(c => c.status_carga === 'montagem' || c.status_carga === 'faturada');

    // Códigos em carga
    const codigosEmCarga = new Set();
    const idsInternosEmCarga = new Set();
    const idsTrocasEmCarga = new Set();
    for (const c of cargasAtivas) {
      (c.pedidos_omie || []).forEach(p => p?.codigo_pedido && codigosEmCarga.add(String(p.codigo_pedido)));
      (c.pedidos_internos || []).forEach(p => p?.pedido_id && idsInternosEmCarga.add(String(p.pedido_id)));
      (c.pedidos_troca || []).forEach(p => p?.pedido_troca_id && idsTrocasEmCarga.add(String(p.pedido_troca_id)));
    }

    // Pedidos locais cancelados
    const codigosCancelados = new Set(
      pedidosLocais.filter(p => p.status === 'cancelado' || p.data_cancelamento)
        .map(p => String(p.omie_codigo_pedido || '')).filter(Boolean)
    );

    // === MONTAGEM DE CARGA: replicar a lógica do useDadosMontagem ===

    // A) Vendas Omie do espelho (etapa 20/50, sem carga, sem cancelados)
    const vendasOmie = espelhoAtivos.filter(e =>
      e.codigo_pedido &&
      !codigosEmCarga.has(String(e.codigo_pedido)) &&
      !codigosCancelados.has(String(e.codigo_pedido))
    );

    // B) Pedidos NF55 locais fora do espelho
    const codigosNoEspelho = new Set(espelho.map(e => String(e.codigo_pedido)).filter(Boolean));
    const nf55LocalFora = pedidosLocais.filter(p => {
      const modelo = String(p.modelo_nota || '').trim().toLowerCase();
      if (modelo === 'd1') return false;
      if (p.status !== 'liberado') return false;
      if (p.carga_id) return false;
      if (p.data_cancelamento) return false;
      if (!p.omie_codigo_pedido) return true;
      return !codigosNoEspelho.has(String(p.omie_codigo_pedido)) &&
             !codigosEmCarga.has(String(p.omie_codigo_pedido));
    });

    // C) D1 liberados sem carga
    const d1Disponiveis = pedidosLocais.filter(p =>
      String(p.modelo_nota || '').trim().toLowerCase() === 'd1' &&
      p.status === 'liberado' &&
      !p.carga_id &&
      !idsInternosEmCarga.has(String(p.id))
    );

    // D) Trocas aprovadas sem carga
    const trocasDisponiveis = trocas.filter(t =>
      !t.carga_id && !idsTrocasEmCarga.has(String(t.id))
    );

    const totalNovaCarga = vendasOmie.length + nf55LocalFora.length + d1Disponiveis.length + trocasDisponiveis.length;

    // === GERENCIAR PEDIDOS: só Pedido local com status=liberado ===
    const pedidosLiberados = pedidosLocais.filter(p => p.status === 'liberado');

    // === Identificar pedidos no espelho SEM correspondência local ===
    const pedidoIdsLocais = new Set(pedidosLocais.map(p => p.id));
    const omieCodigosLocais = new Set(
      pedidosLocais.map(p => String(p.omie_codigo_pedido || '')).filter(Boolean)
    );

    const espelhoSemLocal = vendasOmie.filter(e => {
      const temPedidoId = e.pedido_id && pedidoIdsLocais.has(e.pedido_id);
      const temOmieCodigo = omieCodigosLocais.has(String(e.codigo_pedido));
      return !temPedidoId && !temOmieCodigo;
    });

    // === Pedidos locais liberados que NÃO aparecem na Nova Carga ===
    // (já em carga ou já contados via espelho)
    const codigosNovaCarga = new Set([
      ...vendasOmie.map(e => String(e.codigo_pedido)),
      ...nf55LocalFora.map(p => String(p.omie_codigo_pedido || p.id)),
      ...d1Disponiveis.map(p => String(p.id)),
    ]);

    return Response.json({
      resumo: {
        gerenciar_pedidos_liberados: pedidosLiberados.length,
        pedidos_em_cargas: codigosEmCarga.size + idsInternosEmCarga.size + idsTrocasEmCarga.size,
        nova_carga_total: totalNovaCarga,
        formula: `${vendasOmie.length} (Omie) + ${nf55LocalFora.length} (NF55 local fora espelho) + ${d1Disponiveis.length} (D1) + ${trocasDisponiveis.length} (Trocas) = ${totalNovaCarga}`
      },
      composicao_nova_carga: {
        vendas_omie_espelho: vendasOmie.length,
        nf55_local_fora_espelho: nf55LocalFora.length,
        d1_disponiveis: d1Disponiveis.length,
        trocas_disponiveis: trocasDisponiveis.length
      },
      espelho_sem_correspondencia_local: {
        total: espelhoSemLocal.length,
        pedidos: espelhoSemLocal.map(e => ({
          codigo_pedido: e.codigo_pedido,
          numero_pedido: e.numero_pedido,
          nome_cliente: e.nome_cliente,
          etapa: e.etapa,
          pedido_id_no_espelho: e.pedido_id || null,
          origem_sync: e.origem_sync
        }))
      },
      nf55_local_fora_espelho: {
        total: nf55LocalFora.length,
        pedidos: nf55LocalFora.map(p => ({
          id: p.id,
          numero_pedido: p.numero_pedido,
          cliente_nome: p.cliente_nome,
          omie_codigo_pedido: p.omie_codigo_pedido || 'SEM CODIGO OMIE'
        }))
      },
      trocas_na_montagem: {
        total: trocasDisponiveis.length,
        trocas: trocasDisponiveis.map(t => ({
          id: t.id,
          numero_troca: t.numero_troca,
          cliente_nome: t.cliente_nome,
          valor_total: t.valor_total
        }))
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});