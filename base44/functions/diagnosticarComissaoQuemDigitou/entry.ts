import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// DIAGNÓSTICO SOMENTE LEITURA — NÃO persiste, NÃO recalc Scorecard, NÃO toca no espelho.
//
// Cruza EspelhoFaturamentoNF (comissionáveis, junho/2026) com Pedido (quem digitou) e
// Cliente (dono da carteira) para medir o impacto da nova regra:
//   - Se Pedido.vendedor_id (quem digitou) ≠ Cliente.vendedor_id (dono) → comissão vai pra quem digitou.
//   - Hoje vai pro dono do cliente (regra atual do espelho).
//
// payload: { competencia?: 'YYYY-MM' }  (default: mês atual)

function norm(s) {
  // Normaliza código de pedido: só dígitos, remove zeros à esquerda
  return String(s || '').replace(/\D/g, '').replace(/^0+/, '');
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
    const competencia = body.competencia || new Date().toISOString().slice(0, 7);
    const [ano, mes] = competencia.split('-').map(Number);
    const inicioMes = `${competencia}-01`;
    const fimMes = new Date(ano, mes, 0).toISOString().slice(0, 10);

    const db = base44.asServiceRole.entities;

    // 1) NFs comissionáveis do período
    const nfsRaw = await listarTudo(
      db.EspelhoFaturamentoNF,
      { cancelada: false, comissionavel: true, data_emissao: { $gte: inicioMes, $lte: fimMes } },
      '-data_emissao'
    );

    // de-dup por id
    const seenId = new Set();
    const nfs = [];
    for (const nf of nfsRaw) {
      if (!nf.id || seenId.has(nf.id)) continue;
      seenId.add(nf.id);
      nfs.push(nf);
    }

    // 2) Pedidos do período (todos os tipos, para cruzar via codigo_pedido)
    const pedidosRaw = await listarTudo(
      db.Pedido,
      { data_faturamento: { $gte: inicioMes, $lte: fimMes } },
      '-data_faturamento'
    );
    // Também buscar pedidos sem data_faturamento mas que podem ter sido faturados no período
    // (o cruzamento principal é por codigo_pedido, então precisamos de todos os pedidos relevantes)
    // Mapa por omie_codigo_pedido normalizado
    const pedidoByCod = new Map();
    for (const p of pedidosRaw) {
      const key = norm(p.omie_codigo_pedido);
      if (key && !pedidoByCod.has(key)) {
        pedidoByCod.set(key, p);
      }
    }

    // 3) Clientes — mapa por id para resolver vendedor_id (dono da carteira)
    const clientesRaw = await listarTudo(db.Cliente, {}, '-updated_date');
    const clienteById = new Map();
    for (const c of clientesRaw) {
      if (c.id) clienteById.set(c.id, c);
    }

    // 4) Vendedores — para resolver nomes
    const vendedoresRaw = await db.Vendedor.list('', 2000);
    const nomeVend = new Map();
    for (const v of vendedoresRaw) {
      nomeVend.set(v.id, v.nome);
    }

    // 5) Para cada NF, determinar vendedor_atual, vendedor_dono, vendedor_que_digitou
    let totalAnalisadas = 0;
    let semPedido = 0;          // NF sem Pedido local encontrado → fallback dono
    let semVendedorPedido = 0;   // Pedido encontrado mas vendedor_id vazio → fallback dono
    let semCliente = 0;          // Cliente não encontrado → não dá pra saber o dono
    let donoIgualDigitou = 0;    // dono = quem digitou → não muda
    let donoDifDigitou = 0;      // dono ≠ quem digitou → MUDA
    let valorMigra = 0;          // soma do valor_venda das que mudam

    // Acumuladores por vendedor
    const fatAtual = new Map();  // regra atual (dono do cliente = espelho hoje)
    const fatNovo = new Map();   // regra nova (quem digitou quando divergir, senão dono)
    const detalhesMigracao = []; // amostra de NFs que mudam (top 50 por valor)

    for (const nf of nfs) {
      const valor = Number(nf.valor_venda) || 0;
      if (valor <= 0) continue;
      totalAnalisadas++;

      // vendedor_atual = o que o espelho usa hoje (= dono do cliente, via sync)
      const vendedorAtual = nf.vendedor_id || '';

      // Resolver dono do cliente
      const cliente = nf.cliente_id ? clienteById.get(nf.cliente_id) : null;
      const vendedorDono = cliente?.vendedor_id || '';

      // Resolver quem digitou (via Pedido)
      const codKey = norm(nf.codigo_pedido);
      const pedido = codKey ? pedidoByCod.get(codKey) : null;
      const vendedorDigitou = pedido?.vendedor_id || '';

      // Determinar vendedor novo (regra proposta)
      let vendedorNovo = vendedorDono; // default: dono
      let motivo = 'dono';

      if (!pedido) {
        semPedido++;
        motivo = 'sem_pedido_fallback_dono';
      } else if (!vendedorDigitou) {
        semVendedorPedido++;
        motivo = 'sem_vendedor_pedido_fallback_dono';
      } else if (vendedorDigitou !== vendedorDono) {
        // Divergência: quem digitou ≠ dono → vai pra quem digitou
        donoDifDigitou++;
        valorMigra += valor;
        vendedorNovo = vendedorDigitou;
        motivo = 'migra_quem_digitou';

        if (detalhesMigracao.length < 50) {
          detalhesMigracao.push({
            nf: nf.numero_nf,
            codigo_pedido: nf.codigo_pedido,
            cliente: cliente?.nome_fantasia || cliente?.razao_social || nf.cliente_nome || '',
            valor_venda: +valor.toFixed(2),
            vendedor_dono: { id: vendedorDono, nome: nomeVend.get(vendedorDono) || '(?)' },
            vendedor_digitou: { id: vendedorDigitou, nome: nomeVend.get(vendedorDigitou) || '(?)' },
          });
        }
      } else {
        donoIgualDigitou++;
      }

      // Acumular
      if (vendedorAtual) fatAtual.set(vendedorAtual, (fatAtual.get(vendedorAtual) || 0) + valor);
      if (vendedorNovo) fatNovo.set(vendedorNovo, (fatNovo.get(vendedorNovo) || 0) + valor);
    }

    // 6) Tabela comparativa por vendedor
    const todasChaves = new Set([...fatAtual.keys(), ...fatNovo.keys()]);
    const comparativo = [];
    for (const vid of todasChaves) {
      const antigo = fatAtual.get(vid) || 0;
      const novo = fatNovo.get(vid) || 0;
      comparativo.push({
        vendedor_id: vid,
        vendedor_nome: nomeVend.get(vid) || '(sem match)',
        fat_atual: +antigo.toFixed(2),
        fat_novo: +novo.toFixed(2),
        diff: +(novo - antigo).toFixed(2),
      });
    }
    comparativo.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const totalAtual = comparativo.reduce((s, c) => s + c.fat_atual, 0);
    const totalNovo = comparativo.reduce((s, c) => s + c.fat_novo, 0);

    // Só mostrar na tabela quem tem diff ≠ 0 ou aparece em algum lado
    const comparativoFiltrado = comparativo.filter(c => c.diff !== 0 || c.fat_atual > 0 || c.fat_novo > 0);

    return Response.json({
      diagnostico: true,
      competencia,
      periodo: { inicio: inicioMes, fim: fimMes },
      resumo: {
        nfs_analisadas: totalAnalisadas,
        nfs_mudam_vendedor: donoDifDigitou,
        valor_total_migra: +valorMigra.toFixed(2),
        dono_igual_digitou: donoIgualDigitou,
        sem_pedido_local: semPedido,
        sem_vendedor_no_pedido: semVendedorPedido,
        sem_cliente_cadastrado: semCliente,
      },
      total_atual: +totalAtual.toFixed(2),
      total_novo: +totalNovo.toFixed(2),
      diferenca_total: +(totalNovo - totalAtual).toFixed(2),
      tabela_comparativa: comparativoFiltrado,
      amostra_migracoes: detalhesMigracao.sort((a, b) => b.valor_venda - a.valor_venda),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});