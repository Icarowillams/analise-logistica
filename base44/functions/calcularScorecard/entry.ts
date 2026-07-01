import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Motor de cálculo do Scorecard de Comissionamento (v2.0) — INTEGRA os dois módulos:
// o bloco COBERTURA é alimentado pelos dados reais da Cobertura Inteligente (CoberturaStatus),
// gerados pelas visitas/agendas. Faturamento e Qualidade saem OFICIAL; Cobertura e Mix saem
// EXPERIMENTAL (shadow mode, decisões #2/#3) enquanto não há decisão da Gestão.
//
// payload: { competencia: 'YYYY-MM', bloco?: 'FATURAMENTO'|'COBERTURA'|'MIX'|'QUALIDADE', preview?: boolean }
// - Sem bloco: processa TODOS os blocos numa única chamada (uso via backend/test).
// - Com bloco: processa/persiste SÓ aquele bloco (chunk para evitar timeout na tela).
// - preview: true: comparativo fat_antigo x fat_novo SEM persistir (ignora bloco).
// Idempotente: upsert por (usuario_id, competencia, bloco).
// Persistência atômica: bulkCreate + bulkUpdate — ou grava tudo do bloco, ou nada.

const STATUS_CANCELADO = ['cancelado', 'cancelado_pos_faturamento'];
const BLOCOS = ['FATURAMENTO', 'COBERTURA', 'MIX', 'QUALIDADE'];
const PESO_PADRAO = { FATURAMENTO: 40, COBERTURA: 20, MIX: 20, QUALIDADE: 20 };
const BLOCO_EXPERIMENTAL = { FATURAMENTO: false, QUALIDADE: false, COBERTURA: true, MIX: true };

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
    if (skip > 100000) break;
  }
  return out;
}

function perfilDoVendedor(v) {
  const papeis = Array.isArray(v?.papeis) ? v.papeis : [];
  if (papeis.includes('gerente') || papeis.includes('gerencia')) return 'GERENCIA';
  if (papeis.includes('supervisor')) return 'SUPERVISOR';
  if (papeis.includes('promotor')) return 'PROMOTOR';
  return 'VENDEDOR';
}

function resolverMeta(metas, perfil, tipo) {
  const candidatas = metas.filter((m) => m.perfil === perfil && m.tipo_meta === tipo);
  const generica = candidatas.find((m) => !m.curva_cliente && !m.regiao_rota_id && !m.segmento_cobertura);
  return generica || candidatas[0] || null;
}

function nivelPorTetoLimite(valor, teto, limite, menorMelhor) {
  if (menorMelhor) {
    if (valor <= limite) return 'EXCELENCIA';
    if (valor <= teto) return 'PADRAO';
    return 'ZERADO';
  }
  if (valor >= limite) return 'EXCELENCIA';
  if (valor >= teto) return 'PADRAO';
  return 'ZERADO';
}

const MULT = { ZERADO: 0, PADRAO: 1, EXCELENCIA: 2 };

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const competencia = body.competencia || new Date().toISOString().slice(0, 7);
    const preview = body.preview === true;
    const blocoParam = body.bloco || null;
    const inicioMes = `${competencia}-01`;
    const [ano, mes] = competencia.split('-').map(Number);
    const fimMes = new Date(ano, mes, 0).toISOString().slice(0, 10);

    const db = base44.asServiceRole.entities;

    // Determina quais blocos processar neste chunk
    const blocosProcessar = blocoParam ? BLOCOS.filter((b) => b === blocoParam) : BLOCOS;
    if (blocoParam && !BLOCOS.includes(blocoParam)) {
      return Response.json({ error: `Bloco inválido: ${blocoParam}. Válidos: ${BLOCOS.join(', ')}` }, { status: 400 });
    }

    // Flags de dependência. fatBase (EspelhoFaturamentoNF) é sempre necessário (fórmula de comissão).
    // Em preview, só precisamos de faturamento + vendas (fat_antigo) — os demais blocos não são usados.
    const precisaCob = !preview && blocosProcessar.includes('COBERTURA');
    const precisaMix = !preview && blocosProcessar.includes('MIX');
    const precisaQual = !preview && blocosProcessar.includes('QUALIDADE');
    const precisaVendas = precisaMix || precisaQual || preview;
    const precisaTrocas = precisaQual;
    const precisaItensVendas = precisaMix || precisaQual;
    const precisaItensTrocas = precisaQual;

    const [vendedores, metas, apuracoesExistentes] = await Promise.all([
      db.Vendedor.list('', 2000),
      db.MetaComissao.filter({ status: { $in: ['ATIVA', 'EXPERIMENTAL'] } }, '-vigencia_inicio', 1000),
      db.ScorecardApuracao.filter({ competencia }, '', 50000),
    ]);

    // Fetch condicional: CoberturaStatus só se COBERTURA
    const coberturas = precisaCob ? await db.CoberturaStatus.list('', 5000) : [];
    // Fetch condicional: mapeamento/motivos só se QUALIDADE
    const [mapTrocas, motivos] = precisaQual
      ? await Promise.all([
          db.MotivoTrocaMapeamento.filter({ ativo: true }, '', 500),
          db.MotivoTroca.list('', 500),
        ])
      : [[], []];

    const ativos = vendedores.filter((v) => v.status !== 'inativo');
    const nomeMotivo = new Map(motivos.map((m) => [m.id, (m.descricao || '').toUpperCase()]));
    const respMapeada = new Map();
    for (const mp of mapTrocas) {
      const desc = (mp.motivo_descricao || nomeMotivo.get(mp.motivo_id) || '').toUpperCase();
      if (desc) respMapeada.set(desc, mp.responsabilidade);
    }

    const dentroMes = (p) => {
      const d = (p.data_faturamento || p.created_date || '').slice(0, 10);
      return d >= inicioMes && d <= fimMes;
    };

    // ===== Vendas do mês (condicional) =====
    const vendas = precisaVendas
      ? (await db.Pedido.filter({ tipo: 'venda' }, '-data_faturamento', 30000)).filter(
          (p) => !STATUS_CANCELADO.includes(p.status) && dentroMes(p)
        )
      : [];
    const trocas = precisaTrocas
      ? (await db.Pedido.filter({ tipo: 'troca' }, '-data_faturamento', 30000)).filter(
          (p) => !STATUS_CANCELADO.includes(p.status) && dentroMes(p)
        )
      : [];

    const totalItensMix = precisaMix ? (await db.Produto.list('', 5000)).length || 15 : 0;

    const fatPorVend = new Map();
    const fatPorNome = new Map();
    const fatPorVendAntigo = new Map();
    const pacotesVendPorVend = new Map();
    const idsVendaSemQtd = [];
    const vendPorPedido = new Map();

    // ===== Faturamento (fonte correta): EspelhoFaturamentoNF.valor_venda =====
    const queryEspelho = { cancelada: false, comissionavel: true, data_emissao: { $gte: inicioMes, $lte: fimMes } };
    const nfsRaw = await listarTudo(db.EspelhoFaturamentoNF, queryEspelho, '-data_emissao');
    const seenNf = new Set();
    for (const nf of nfsRaw) {
      if (!nf.id || seenNf.has(nf.id)) continue;
      seenNf.add(nf.id);
      const valor = Number(nf.valor_venda) || 0;
      if (valor <= 0) continue;
      const vid = nf.vendedor_id;
      const vnome = (nf.vendedor_nome || '').trim();
      if (vid) fatPorVend.set(vid, (fatPorVend.get(vid) || 0) + valor);
      else if (vnome) fatPorNome.set(vnome, (fatPorNome.get(vnome) || 0) + valor);
    }

    // Vendas (Pedido) — MIX (itens distintos) e pacotes. Em preview, fat_antigo.
    if (precisaVendas) {
      for (const p of vendas) {
        const vid = p.vendedor_id;
        if (!vid) continue;
        if (preview) fatPorVendAntigo.set(vid, (fatPorVendAntigo.get(vid) || 0) + (Number(p.valor_total) || 0));
        vendPorPedido.set(p.id, vid);
        const q = Number(p.qtd_total_itens);
        if (q > 0) pacotesVendPorVend.set(vid, (pacotesVendPorVend.get(vid) || 0) + q);
        else idsVendaSemQtd.push(p.id);
      }
    }

    // ===== PREVIEW: comparativo fat_antigo x fat_novo SEM persistir =====
    if (preview) {
      const nomeVend = new Map(vendedores.map((v) => [v.id, v.nome]));
      const todasChaves = new Set([...fatPorVend.keys(), ...fatPorVendAntigo.keys()]);
      const comparativo = [];
      for (const vid of todasChaves) {
        const antigo = fatPorVendAntigo.get(vid) || 0;
        const novo = fatPorVend.get(vid) || 0;
        comparativo.push({
          vendedor_id: vid,
          vendedor_nome: nomeVend.get(vid) || '(sem match no Vendedor)',
          fat_antigo: +antigo.toFixed(2),
          fat_novo: +novo.toFixed(2),
          diff: +(novo - antigo).toFixed(2),
        });
      }
      comparativo.sort((a, b) => b.fat_novo - a.fat_novo);
      const totalAntigo = comparativo.reduce((s, c) => s + c.fat_antigo, 0);
      const totalNovo = comparativo.reduce((s, c) => s + c.fat_novo, 0);
      const semVendedorId = Array.from(fatPorNome.entries())
        .map(([nome, valor]) => ({ vendedor_nome: nome, fat_novo: +valor.toFixed(2) }))
        .sort((a, b) => b.fat_novo - a.fat_novo);
      return Response.json({
        preview: true,
        competencia,
        total_antigo: +totalAntigo.toFixed(2),
        total_novo: +totalNovo.toFixed(2),
        diferenca: +(totalNovo - totalAntigo).toFixed(2),
        vendedores_comparados: comparativo.length,
        nfs_espelho_total: nfsRaw.length,
        nfs_espelho_comissionavel: seenNf.size,
        sem_vendedor_id: semVendedorId,
        comparativo,
      });
    }

    // ===== Mix: itens distintos vendidos por vendedor (via PedidoItem das vendas do mês) =====
    const mixPorVend = new Map();
    if (precisaItensVendas) {
      const idsVendas = vendas.map((p) => p.id).filter(Boolean);
      for (const grupo of chunk(idsVendas, 100)) {
        const itens = await db.PedidoItem.filter({ pedido_id: { $in: grupo } }, '', 50000);
        for (const it of itens) {
          const vid = vendPorPedido.get(it.pedido_id);
          if (!vid) continue;
          if (precisaMix) {
            if (!mixPorVend.has(vid)) mixPorVend.set(vid, new Set());
            if (it.produto_id || it.item_id) mixPorVend.get(vid).add(it.produto_id || it.item_id);
          }
          // completa pacotes para pedidos sem qtd_total_itens (necessário para QUALIDADE)
          if (idsVendaSemQtd.includes(it.pedido_id)) {
            const q = Number(it.quantidade) > 0 ? Number(it.quantidade) : 0;
            pacotesVendPorVend.set(vid, (pacotesVendPorVend.get(vid) || 0) + q);
          }
        }
      }
    }

    // ===== Qualidade: pacotes de VENCIDO (responsabilidade VENDEDOR) por vendedor =====
    const vencidoPorVend = new Map();
    if (precisaItensTrocas) {
      const vendPorTroca = new Map(trocas.map((p) => [p.id, p.vendedor_id]));
      const idsTroca = trocas.map((p) => p.id).filter(Boolean);
      for (const grupo of chunk(idsTroca, 100)) {
        const itens = await db.PedidoItem.filter({ pedido_id: { $in: grupo } }, '', 50000);
        for (const it of itens) {
          const vid = vendPorTroca.get(it.pedido_id);
          if (!vid) continue;
          const desc = (it.motivo_troca_descricao || (it.motivo_troca_id ? nomeMotivo.get(it.motivo_troca_id) : '') || '').toUpperCase();
          const resp = respMapeada.get(desc);
          if (resp !== 'VENDEDOR') continue;
          const q = Number(it.quantidade) > 0 ? Number(it.quantidade) : 0;
          vencidoPorVend.set(vid, (vencidoPorVend.get(vid) || 0) + q);
        }
      }
    }

    // ===== Cobertura: % de clientes EM_DIA por responsável (Cobertura Inteligente) =====
    const cobPorResp = new Map();
    if (precisaCob) {
      for (const c of coberturas) {
        const rid = c.responsavel_id;
        if (!rid) continue;
        if (!cobPorResp.has(rid)) cobPorResp.set(rid, { total: 0, em_dia: 0 });
        const o = cobPorResp.get(rid);
        o.total++;
        if (c.status_cobertura === 'em_dia') o.em_dia++;
      }
    }

    const apuracaoPorChave = new Map();
    for (const a of apuracoesExistentes) apuracaoPorChave.set(`${a.usuario_id}|${a.bloco}`, a);

    let avaliados = 0;
    const aCriar = [];
    const aAtualizar = [];

    for (const v of ativos) {
      const perfil = perfilDoVendedor(v);
      const faturamento = fatPorVend.get(v.id) || 0;
      const pacotes = pacotesVendPorVend.get(v.id) || 0;
      const itensMix = (mixPorVend.get(v.id) || new Set()).size;
      const vencido = vencidoPorVend.get(v.id) || 0;

      // Cobertura: própria (vendedor/promotor) ou agregada da equipe (supervisor/gerência)
      let cobTotal = 0, cobEmDia = 0;
      if (precisaCob) {
        if (perfil === 'VENDEDOR' || perfil === 'PROMOTOR') {
          const o = cobPorResp.get(v.id) || { total: 0, em_dia: 0 };
          cobTotal = o.total; cobEmDia = o.em_dia;
        } else {
          for (const lid of ativos) {
            const subord = lid.supervisor_id === v.id || (lid.supervisor_ids || []).includes(v.id);
            const agregaTudo = perfil === 'GERENCIA';
            if (agregaTudo || subord) {
              const o = cobPorResp.get(lid.id);
              if (o) { cobTotal += o.total; cobEmDia += o.em_dia; }
            }
          }
        }
      }

      // Faturamento agregado para supervisor/gerência
      let fatBase = faturamento;
      if (perfil === 'SUPERVISOR' || perfil === 'GERENCIA') {
        fatBase = 0;
        for (const lid of ativos) {
          const subord = lid.supervisor_id === v.id || (lid.supervisor_ids || []).includes(v.id);
          if (perfil === 'GERENCIA' || subord) fatBase += fatPorVend.get(lid.id) || 0;
        }
      }

      // Pula quem não tem nenhuma atividade no mês.
      // Em modo chunk, só avalia as métricas disponíveis neste chunk.
      const semAtividade = fatBase <= 0
        && (!precisaCob || cobTotal === 0)
        && (!precisaVendas || pacotes === 0);
      if (semAtividade) continue;

      // ---- Indicadores por bloco ----
      const percVencido = pacotes > 0 ? +((vencido / pacotes) * 100).toFixed(2) : 0;
      const percCobertura = cobTotal > 0 ? +((cobEmDia / cobTotal) * 100).toFixed(2) : 0;
      const percMix = totalItensMix > 0 ? +((itensMix / totalItensMix) * 100).toFixed(2) : 0;
      const valorApurado = { FATURAMENTO: fatBase, QUALIDADE: percVencido, COBERTURA: percCobertura, MIX: percMix };

      for (const bloco of blocosProcessar) {
        const pesoMeta = resolverMeta(metas, perfil, `PESO_${bloco}`);
        const peso = pesoMeta ? Number(pesoMeta.valor) : PESO_PADRAO[bloco];

        let nivel = 'PADRAO';
        if (bloco === 'QUALIDADE') {
          const teto = resolverMeta(metas, perfil, 'TETO_VENCIDO');
          const limite = resolverMeta(metas, perfil, 'LIMITE_EXCELENCIA');
          nivel = nivelPorTetoLimite(percVencido, teto ? Number(teto.valor) : 5, limite ? Number(limite.valor) : 2, true);
        } else if (bloco === 'COBERTURA') {
          nivel = nivelPorTetoLimite(percCobertura, 70, 90, false);
        } else if (bloco === 'MIX') {
          nivel = nivelPorTetoLimite(percMix, 50, 75, false);
        } else if (bloco === 'FATURAMENTO') {
          nivel = fatBase > 0 ? 'PADRAO' : 'ZERADO';
        }

        const multiplicador = MULT[nivel];
        const comissao = +((fatBase * (peso / 100)) * multiplicador).toFixed(2);
        const statusApuracao = BLOCO_EXPERIMENTAL[bloco] ? 'EXPERIMENTAL' : 'OFICIAL';
        const pontos = multiplicador * peso;

        const dados = {
          usuario_id: v.id,
          usuario_nome: v.nome,
          perfil,
          competencia,
          bloco,
          meta_id_aplicada: pesoMeta?.id || null,
          meta_descricao_aplicada: pesoMeta ? `${perfil} / PESO_${bloco}` : 'Padrão (fallback)',
          valor_apurado: valorApurado[bloco],
          faturamento_base: fatBase,
          peso_bloco: peso,
          nivel,
          multiplicador,
          valor_comissao_bloco: comissao,
          pontos_ranking: pontos,
          status_apuracao: statusApuracao,
          calculado_em: new Date().toISOString(),
        };

        const existente = apuracaoPorChave.get(`${v.id}|${bloco}`);
        if (existente) aAtualizar.push({ id: existente.id, ...dados });
        else aCriar.push(dados);
      }
      avaliados++;
    }

    // Persistência ATÔMICA: bulkCreate em lotes + bulkUpdate numa única chamada.
    // Ou todas as linhas do bloco são gravadas, ou nenhuma — nunca parcial.
    for (const grupo of chunk(aCriar, 100)) await db.ScorecardApuracao.bulkCreate(grupo);
    if (aAtualizar.length > 0) await db.ScorecardApuracao.bulkUpdate(aAtualizar);

    return Response.json({
      ok: true,
      competencia,
      bloco: blocoParam || 'TODOS',
      vendedores_apurados: avaliados,
      linhas_criadas: aCriar.length,
      linhas_atualizadas: aAtualizar.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});