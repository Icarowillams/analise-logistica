import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function comRetry(fn, maxTentativas = 5) {
  let espera = 800;
  for (let t = 1; t <= maxTentativas; t++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || '');
      const isRate = msg.includes('429') || msg.toLowerCase().includes('rate limit');
      if (isRate && t < maxTentativas) { await sleep(espera); espera = Math.min(espera * 2, 8000); continue; }
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
    const { dry_run = false, limite_lote = 60, delay_ms = 200 } = body;

    // 1) Pedidos tipo troca vinculados a cargas
    const pedidosTroca = await base44.asServiceRole.entities.Pedido.filter({ tipo: 'troca' }, '-created_date', 5000);
    const comCarga = pedidosTroca.filter(p => p.numero_carga);

    // 2) Cargas indexadas por numero_carga
    const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 5000);
    const mapaCarga = new Map(cargas.map(c => [String(c.numero_carga), c]));

    // 3) Trocas ausentes do array pedidos_troca da carga correspondente
    const ausentes = [];
    for (const p of comCarga) {
      const c = mapaCarga.get(String(p.numero_carga));
      if (!c) continue;
      const presente = (c.pedidos_troca || []).some(t => String(t.pedido_troca_id) === String(p.id) || String(t.pedido_id) === String(p.id));
      if (!presente) ausentes.push(p);
    }

    if (dry_run) {
      return Response.json({ sucesso: true, dry_run: true, ausentes_total: ausentes.length, exemplos: ausentes.slice(0, 30).map(p => ({ numero_pedido: p.numero_pedido, numero_carga: p.numero_carga, cliente: p.cliente_nome_fantasia || p.cliente_nome })) });
    }

    const lote = ausentes.slice(0, limite_lote);

    // 4) Carrega itens locais de todos os pedidos do lote em chunks de 40 ($in)
    const itensPorPedido = new Map();
    const ids = lote.map(p => p.id).filter(Boolean);
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const itens = await comRetry(() => base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: { $in: chunk } }, '-created_date', 5000));
      for (const it of itens) {
        if (!itensPorPedido.has(it.pedido_id)) itensPorPedido.set(it.pedido_id, []);
        itensPorPedido.get(it.pedido_id).push(it);
      }
    }

    // 5) Agrupa as inserções por carga (para 1 update por carga)
    const insercoesPorCarga = new Map();
    for (const p of lote) {
      const c = mapaCarga.get(String(p.numero_carga));
      if (!c) continue;
      const itens = itensPorPedido.get(p.id) || [];
      const produtos = itens.map(i => ({
        codigo_produto: i.produto_codigo || '',
        descricao: i.produto_descricao || i.produto_nome || '',
        quantidade: Number(i.quantidade || 0),
        valor_unitario: Number(i.valor_unitario || 0),
        valor_total: Number(i.valor_total || 0),
        unidade: i.unidade_medida || 'UN',
        motivo_troca_id: i.motivo_troca_id || '',
        motivo_troca_descricao: i.motivo_troca_descricao || ''
      }));
      const qtd = produtos.reduce((s, x) => s + (x.quantidade || 0), 0);
      const registro = {
        pedido_troca_id: p.id,
        pedido_id: p.id,
        numero_pedido: p.numero_pedido || '',
        cliente_id: p.cliente_id || '',
        nome_cliente: p.cliente_nome || '',
        nome_fantasia: p.cliente_nome_fantasia || '',
        cidade: p.cliente_cidade || '',
        rota_cliente: p.rota_nome || '',
        valor_total_pedido: Number(p.valor_total || 0),
        quantidade_itens: qtd,
        produtos
      };
      if (!insercoesPorCarga.has(c.id)) insercoesPorCarga.set(c.id, { carga: c, registros: [] });
      insercoesPorCarga.get(c.id).registros.push(registro);
    }

    let cargasAtualizadas = 0;
    let trocasInseridas = 0;
    let erros = 0;
    const detalhes = [];

    for (const [cargaId, { carga, registros }] of insercoesPorCarga) {
      try {
        const atual = (carga.pedidos_troca || []);
        // evita duplicar se já existir
        const idsExistentes = new Set(atual.map(t => String(t.pedido_troca_id || t.pedido_id)));
        const novos = registros.filter(r => !idsExistentes.has(String(r.pedido_troca_id)));
        if (!novos.length) continue;
        await comRetry(() => base44.asServiceRole.entities.Carga.update(cargaId, { pedidos_troca: [...atual, ...novos] }));
        cargasAtualizadas++;
        trocasInseridas += novos.length;
        detalhes.push({ numero_carga: carga.numero_carga, trocas_add: novos.length });
        if (delay_ms > 0) await sleep(delay_ms);
      } catch (e) {
        erros++;
        detalhes.push({ numero_carga: carga.numero_carga, erro: e.message });
      }
    }

    const restantes = Math.max(0, ausentes.length - trocasInseridas);
    return Response.json({
      sucesso: true,
      ausentes_total: ausentes.length,
      processados_neste_lote: lote.length,
      cargas_atualizadas: cargasAtualizadas,
      trocas_inseridas: trocasInseridas,
      erros,
      restantes,
      mensagem: restantes > 0 ? `${trocasInseridas} troca(s) reconciliada(s). Restam ~${restantes} — execute novamente.` : `Reconciliação concluída. ${trocasInseridas} troca(s) inserida(s).`,
      detalhes: detalhes.slice(0, 50)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});