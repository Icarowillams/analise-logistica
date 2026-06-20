import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─────────────────────────────────────────────────────────────────────────────
// Reparo LOCAL de cargas com pedidos de VENDA sem produtos.
//
// Causa raiz: na montagem, os produtos são copiados do espelho PedidoLiberadoOmie.
// Se o espelho ainda não sincronizou os itens no momento do fechamento, a carga
// grava o pedido com produtos: [] → listagem de carregamento sai EM BRANCO.
//
// Este reparo é 100% LOCAL (espelho + PedidoItem). NÃO chama a Omie, NÃO fatura/emite.
//
// Modos:
//  - { carga_id }     → repara UMA carga, regrava se houve mudança. Retorna detalhes.
//  - { dry_run: true } → VARREDURA: lista cargas (montagem/faturada) com pedido de
//                        VENDA com produtos vazios. NÃO altera nada.
// ─────────────────────────────────────────────────────────────────────────────

// pedidos_omie contém SOMENTE vendas/bonificações (D1 vai em pedidos_internos,
// troca em pedidos_troca). Por isso reparamos qualquer item vazio deste array
// sem risco de afetar trocas/D1.

function temProdutos(p) {
  return Array.isArray(p.produtos) && p.produtos.length > 0;
}

function montarProdutosDoEspelho(espelho) {
  return (espelho.produtos || []).map(pr => ({
    codigo_produto: pr.codigo_produto || '',
    codigo_produto_integracao: pr.codigo_produto_integracao || '',
    descricao: pr.descricao || '',
    quantidade: Number(pr.quantidade) || 0,
    valor_unitario: Number(pr.valor_unitario) || 0,
    valor_total: Number(pr.valor_total) || 0,
    unidade: pr.unidade || 'UN'
  }));
}

function montarProdutosDoPedidoItem(itens) {
  return (itens || []).map(i => ({
    codigo_produto: i.produto_codigo || '',
    codigo_produto_integracao: '',
    descricao: i.produto_nome || '',
    quantidade: Number(i.quantidade) || 0,
    valor_unitario: Number(i.valor_unitario) || 0,
    valor_total: Number(i.valor_total) || 0,
    unidade: i.unidade_medida || 'UN'
  }));
}

function recomputarResumo(pedidosOmie, pedidosInternos, pedidosTroca) {
  const mapa = new Map();
  let totalPacotes = 0;
  [...(pedidosOmie || []), ...(pedidosInternos || []), ...(pedidosTroca || [])].forEach(ped => {
    (ped.produtos || []).forEach(pr => {
      const qtd = Number(pr.quantidade) || 0;
      totalPacotes += qtd;
      const chave = pr.codigo_produto || pr.descricao || '';
      if (!mapa.has(chave)) {
        mapa.set(chave, { codigo_produto: pr.codigo_produto || '', descricao: pr.descricao || '', quantidade_total: 0, unidade: pr.unidade || 'UN' });
      }
      mapa.get(chave).quantidade_total += qtd;
    });
  });
  return { produtosResumo: Array.from(mapa.values()), totalPacotes };
}

async function repararUmaCarga(base44, carga, espelhoPorCodigo, getItensPedido) {
  const pedidosOmie = carga.pedidos_omie || [];
  let mudou = false;
  const reparados = [];

  const novosPedidosOmie = [];
  for (const p of pedidosOmie) {
    // pedidos_omie são sempre vendas. Reparar apenas se vazio.
    if (temProdutos(p)) { novosPedidosOmie.push(p); continue; }

    let produtos = [];
    let fonte = null;

    // 1) Espelho PedidoLiberadoOmie (match por codigo_pedido)
    const espelho = espelhoPorCodigo.get(String(p.codigo_pedido || ''));
    if (espelho && (espelho.produtos || []).length > 0) {
      produtos = montarProdutosDoEspelho(espelho);
      fonte = 'espelho';
    }

    // 2) PedidoItem local (por pedido_id)
    if (produtos.length === 0 && p.pedido_id) {
      const itens = await getItensPedido(p.pedido_id);
      if (itens.length > 0) {
        produtos = montarProdutosDoPedidoItem(itens);
        fonte = 'pedido_item';
      }
    }

    if (produtos.length > 0) {
      mudou = true;
      reparados.push({ numero_pedido: p.numero_pedido || p.codigo_pedido, fonte, itens: produtos.length });
      novosPedidosOmie.push({ ...p, produtos, quantidade_itens: produtos.length });
    } else {
      novosPedidosOmie.push(p);
    }
  }

  if (!mudou) return { reparada: false, reparados: [] };

  const { produtosResumo, totalPacotes } = recomputarResumo(novosPedidosOmie, carga.pedidos_internos, carga.pedidos_troca);
  await base44.asServiceRole.entities.Carga.update(carga.id, {
    pedidos_omie: novosPedidosOmie,
    produtos_resumo: produtosResumo,
    quantidade_total_pacotes: totalPacotes
  });
  return { reparada: true, reparados };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { carga_id, dry_run } = body;

    // Cache de itens locais por pedido_id (evita N consultas repetidas)
    const cacheItens = new Map();
    const getItensPedido = async (pedidoId) => {
      if (cacheItens.has(pedidoId)) return cacheItens.get(pedidoId);
      const itens = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: pedidoId }, '-created_date', 500);
      cacheItens.set(pedidoId, itens || []);
      return itens || [];
    };

    // ─── VARREDURA dry-run ───
    if (dry_run) {
      const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 5000);
      const afetadas = (cargas || [])
        .filter(c => c.status_carga === 'montagem' || c.status_carga === 'faturada')
        .map(c => {
          const vazios = (c.pedidos_omie || [])
            .filter(p => !temProdutos(p))
            .map(p => p.numero_pedido || p.codigo_pedido);
          return vazios.length > 0
            ? { carga_id: c.id, numero_carga: c.numero_carga, pedidos_vazios: vazios }
            : null;
        })
        .filter(Boolean);
      return Response.json({ sucesso: true, dry_run: true, total_cargas_afetadas: afetadas.length, cargas: afetadas });
    }

    // ─── Reparo de UMA carga ───
    if (!carga_id) {
      return Response.json({ sucesso: false, error: 'carga_id obrigatório (ou dry_run=true)' }, { status: 400 });
    }

    const carga = await base44.asServiceRole.entities.Carga.filter({ id: carga_id }, '-created_date', 1);
    if (!carga || carga.length === 0) {
      return Response.json({ sucesso: false, error: 'Carga não encontrada' }, { status: 404 });
    }

    // Carregar espelho apenas dos códigos vazios desta carga
    const codigosVazios = (carga[0].pedidos_omie || [])
      .filter(p => !temProdutos(p))
      .map(p => String(p.codigo_pedido || ''))
      .filter(Boolean);

    const espelhoPorCodigo = new Map();
    if (codigosVazios.length > 0) {
      for (let i = 0; i < codigosVazios.length; i += 40) {
        const chunk = codigosVazios.slice(i, i + 40);
        const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: { $in: chunk } }, '-created_date', 200);
        (espelhos || []).forEach(e => espelhoPorCodigo.set(String(e.codigo_pedido), e));
      }
    }

    const resultado = await repararUmaCarga(base44, carga[0], espelhoPorCodigo, getItensPedido);
    return Response.json({ sucesso: true, ...resultado });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});