import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Atualiza 1 registro com retry/backoff em caso de rate limit (429).
async function atualizarComRetry(base44, id, dados, maxTentativas = 5) {
  let espera = 800;
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      await base44.asServiceRole.entities.PedidoLiberadoOmie.update(id, dados);
      return;
    } catch (e) {
      const msg = String(e?.message || '');
      const isRate = msg.includes('429') || msg.toLowerCase().includes('rate limit');
      if (isRate && tentativa < maxTentativas) {
        await sleep(espera);
        espera = Math.min(espera * 2, 8000);
        continue;
      }
      throw e;
    }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin apenas' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    // limite_lote: quantos espelhos preencher por execução (re-executável). delay_ms: pausa entre updates.
    const { dry_run = false, limite_lote = 80, delay_ms = 200 } = body;

    // Espelhos zerados: sem produtos E quantidade_itens 0, que NÃO sejam cancelados, e que tenham pedido_id
    // (os itens locais existem no PedidoItem — preenchemos sem tocar no Omie).
    const todos = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('-sincronizado_em', 5000);
    const zeradosTotal = (todos || []).filter(e =>
      (!e.produtos || e.produtos.length === 0) &&
      Number(e.quantidade_itens || 0) === 0 &&
      e.status_real !== 'cancelada' &&
      e.etapa !== '99' &&
      e.pedido_id
    );

    console.log(`[preencherEspelhosZerados] ${zeradosTotal.length} espelhos zerados de ${(todos || []).length} total`);

    if (dry_run) {
      return Response.json({
        sucesso: true,
        dry_run: true,
        zerados_total: zeradosTotal.length,
        amostra: zeradosTotal.slice(0, 50).map(z => ({
          numero_pedido: z.numero_pedido,
          etapa: z.etapa,
          origem_sync: z.origem_sync
        }))
      });
    }

    const lote = zeradosTotal.slice(0, limite_lote);

    // Carrega os PedidoItem dos pedidos do lote em chunks de 40 ($in)
    const itensPorPedido = new Map();
    const idsLote = lote.map(z => z.pedido_id).filter(Boolean);
    for (let i = 0; i < idsLote.length; i += 40) {
      const chunk = idsLote.slice(i, i + 40);
      const itens = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: { $in: chunk } }, '-created_date', 5000).catch(() => []);
      for (const it of itens) {
        if (!itensPorPedido.has(it.pedido_id)) itensPorPedido.set(it.pedido_id, []);
        itensPorPedido.get(it.pedido_id).push(it);
      }
    }

    let preenchidos = 0;
    let semItens = 0;
    let erros = 0;
    const detalhes = [];

    for (const z of lote) {
      try {
        const itensLocais = itensPorPedido.get(z.pedido_id) || [];
        if (itensLocais.length === 0) {
          semItens++;
          detalhes.push({ numero_pedido: z.numero_pedido, status: 'sem_itens_locais' });
          continue;
        }
        const produtos = itensLocais.map(it => ({
          codigo_produto: it.produto_codigo || '',
          codigo_produto_integracao: '',
          descricao: it.produto_descricao || it.produto_nome || '',
          quantidade: Number(it.quantidade || 0),
          valor_unitario: Number(it.valor_unitario || 0),
          valor_total: Number(it.valor_total || 0),
          unidade: it.unidade_medida || ''
        }));
        const quantidadeItens = produtos.reduce((s, p) => s + (p.quantidade || 0), 0);

        await atualizarComRetry(base44, z.id, { produtos, quantidade_itens: quantidadeItens });
        preenchidos++;
        detalhes.push({ numero_pedido: z.numero_pedido, linhas: produtos.length, qtd: quantidadeItens, status: 'preenchido' });
        if (delay_ms > 0) await sleep(delay_ms);
      } catch (e) {
        erros++;
        detalhes.push({ numero_pedido: z.numero_pedido, status: 'erro', erro: e.message });
        console.error(`[preencherEspelhosZerados] Erro no pedido ${z.numero_pedido}: ${e.message}`);
      }
    }

    const restantes = Math.max(0, zeradosTotal.length - preenchidos - semItens);

    return Response.json({
      sucesso: true,
      zerados_total: zeradosTotal.length,
      processados_neste_lote: lote.length,
      preenchidos,
      sem_itens_locais: semItens,
      erros,
      restantes,
      mensagem: restantes > 0
        ? `${preenchidos} espelho(s) preenchido(s). Ainda restam ${restantes} — execute novamente para continuar.`
        : `${preenchidos} espelho(s) preenchido(s). Reconciliação concluída.`,
      detalhes: detalhes.slice(0, 50)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});