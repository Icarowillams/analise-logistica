import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Transferência de Carteira de Vendedor — move TODOS os clientes de um vendedor (origem)
// para outro (destino). Opcionalmente reatribui vendas históricas no EspelhoFaturamentoNF.
//
// payload: {
//   vendedor_origem_id: string,
//   vendedor_destino_id: string,
//   reativar_vendas?: boolean (default false),
//   competencia?: 'YYYY-MM' (se reativar_vendas, filtra NFs por data_emissao no mês; sem = todo histórico),
//   preview?: boolean (true = não persiste, só conta)
// }
//
// Admin-only. Idempotente. Não toca em Pedido histórico, NF fiscal, nem cancelamento.
// Não recalcula Scorecard — o admin roda calcularScorecard depois.

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function listarTudo(entidade, query, ordem) {
  const out = [];
  let skip = 0;
  const lote = 500;
  while (true) {
    const page = await entidade.filter(query, ordem, lote, skip);
    out.push(...page);
    if (page.length < lote) break;
    skip += lote;
    if (skip > 50000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const origemId = body.vendedor_origem_id;
    const destinoId = body.vendedor_destino_id;
    const reativarVendas = body.reativar_vendas === true;
    const competencia = body.competencia || null;
    const preview = body.preview === true;

    if (!origemId || !destinoId) {
      return Response.json({ error: 'vendedor_origem_id e vendedor_destino_id são obrigatórios' }, { status: 400 });
    }
    if (origemId === destinoId) {
      return Response.json({ error: 'Vendedor de origem e destino devem ser diferentes' }, { status: 400 });
    }

    const db = base44.asServiceRole.entities;

    // Resolver nomes dos vendedores origem e destino
    const [origem, destino] = await Promise.all([
      db.Vendedor.get(origemId).catch(() => null),
      db.Vendedor.get(destinoId).catch(() => null),
    ]);
    if (!destino) return Response.json({ error: 'Vendedor de destino não encontrado' }, { status: 400 });
    const origemNome = origem?.nome || '(origem)';
    const destinoNome = destino.nome || '';

    // Período para reatribuição de vendas
    let inicioMes = null, fimMes = null;
    if (reativarVendas && competencia) {
      const [ano, mes] = competencia.split('-').map(Number);
      inicioMes = `${competencia}-01`;
      fimMes = new Date(ano, mes, 0).toISOString().slice(0, 10);
    }

    // 1) Buscar clientes da carteira de origem (de-dup por id)
    const clientesRaw = await listarTudo(db.Cliente, { vendedor_id: origemId }, 'razao_social');
    const seenCli = new Set();
    const clientes = [];
    for (const c of clientesRaw) {
      if (!c.id || seenCli.has(c.id)) continue;
      seenCli.add(c.id);
      clientes.push(c);
    }
    const clienteIds = clientes.map((c) => c.id);

    // 2) Buscar NFs do período (se reativar_vendas) — de-dup por id
    let nfs = [];
    let valorVendaPeriodo = 0;
    let nfsComissionavelCount = 0;
    if (reativarVendas && clienteIds.length > 0) {
      const queryNf = { cliente_id: { $in: clienteIds } };
      if (inicioMes) queryNf.data_emissao = { $gte: inicioMes, $lte: fimMes };
      const nfsRaw = await listarTudo(db.EspelhoFaturamentoNF, queryNf, '-data_emissao');
      const seenNf = new Set();
      for (const nf of nfsRaw) {
        if (!nf.id || seenNf.has(nf.id)) continue;
        seenNf.add(nf.id);
        nfs.push(nf);
        const v = Number(nf.valor_venda) || 0;
        if (nf.tipo === 'venda' && !nf.cancelada && v > 0) {
          valorVendaPeriodo += v;
          nfsComissionavelCount++;
        }
      }
    }

    // ===== PREVIEW: só conta, não persiste =====
    if (preview) {
      return Response.json({
        preview: true,
        vendedor_origem_id: origemId,
        vendedor_origem_nome: origemNome,
        vendedor_destino_id: destinoId,
        vendedor_destino_nome: destinoNome,
        reativar_vendas: reativarVendas,
        competencia,
        total_clientes: clientes.length,
        total_nfs_periodo: nfs.length,
        nfs_comissionavel: nfsComissionavelCount,
        valor_venda_periodo: +valorVendaPeriodo.toFixed(2),
        amostra_clientes: clientes.slice(0, 10).map((c) => ({
          id: c.id,
          nome: c.nome_fantasia || c.razao_social,
          cidade: c.cidade,
        })),
      });
    }

    // ===== EXECUÇÃO REAL =====

    // 3) bulkUpdate atômico nos Clientes — só vendedor_id (Cliente não tem vendedor_nome)
    const clienteUpdates = clientes.map((c) => ({ id: c.id, vendedor_id: destinoId }));
    let clientesAtualizados = 0;
    for (const grupo of chunk(clienteUpdates, 500)) {
      await db.Cliente.bulkUpdate(grupo);
      clientesAtualizados += grupo.length;
    }

    // 4) Reatribuir vendas no EspelhoFaturamentoNF (bulkUpdate atômico por id, de-dup)
    let nfsAtualizadas = 0;
    let nfsComissionavelAtualizadas = 0;
    let valorVendaReatribuido = 0;
    if (reativarVendas && nfs.length > 0) {
      const updates = nfs.map((nf) => {
        const comissionavel = nf.tipo === 'venda' && !nf.cancelada;
        if (comissionavel) {
          nfsComissionavelAtualizadas++;
          valorVendaReatribuido += Number(nf.valor_venda) || 0;
        }
        return {
          id: nf.id,
          vendedor_id: destinoId,
          vendedor_nome: destinoNome,
          comissionavel,
        };
      });
      for (const grupo of chunk(updates, 500)) {
        await db.EspelhoFaturamentoNF.bulkUpdate(grupo);
        nfsAtualizadas += grupo.length;
      }
    }

    // 5) Auditoria no LogGerencial
    await db.LogGerencial.create({
      tipo_acao: 'transferencia',
      entidade_tipo: 'Cliente',
      entidade_descricao: `${clientesAtualizados} cliente(s): ${origemNome} → ${destinoNome}`,
      descricao:
        `Transferência de carteira: ${clientesAtualizados} clientes de ${origemNome} → ${destinoNome}` +
        (reativarVendas ? ` + reatribuição de ${nfsAtualizadas} NFs (${competencia || 'todo histórico'}) — R$ ${valorVendaReatribuido.toFixed(2)} em vendas comissionáveis` : ''),
      usuario_email: user.email,
      usuario_nome: user.full_name || user.email,
      origem: 'frontend',
    });

    return Response.json({
      ok: true,
      vendedor_origem_nome: origemNome,
      vendedor_destino_nome: destinoNome,
      clientes_atualizados: clientesAtualizados,
      nfs_atualizadas: nfsAtualizadas,
      nfs_comissionavel_atualizadas: nfsComissionavelAtualizadas,
      valor_venda_reatribuido: +valorVendaReatribuido.toFixed(2),
      cliente_ids: clienteIds,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});