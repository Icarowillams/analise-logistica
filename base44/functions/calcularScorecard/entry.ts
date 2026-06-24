import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Motor de cálculo do Scorecard de Comissionamento (v2.0) — INTEGRA os dois módulos:
// o bloco COBERTURA é alimentado pelos dados reais da Cobertura Inteligente (CoberturaStatus),
// gerados pelas visitas/agendas. Faturamento e Qualidade saem OFICIAL; Cobertura e Mix saem
// EXPERIMENTAL (shadow mode, decisões #2/#3) enquanto não há decisão da Gestão.
//
// payload: { competencia: 'YYYY-MM' }
// Idempotente: upsert por (usuario_id, competencia, bloco).

const STATUS_CANCELADO = ['cancelado', 'cancelado_pos_faturamento'];
const BLOCOS = ['FATURAMENTO', 'COBERTURA', 'MIX', 'QUALIDADE'];
const PESO_PADRAO = { FATURAMENTO: 40, COBERTURA: 20, MIX: 20, QUALIDADE: 20 };
// Cobertura e Mix ainda em calibração → não compõem pagamento real.
const BLOCO_EXPERIMENTAL = { FATURAMENTO: false, QUALIDADE: false, COBERTURA: true, MIX: true };

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function perfilDoVendedor(v) {
  const papeis = Array.isArray(v?.papeis) ? v.papeis : [];
  if (papeis.includes('gerente') || papeis.includes('gerencia')) return 'GERENCIA';
  if (papeis.includes('supervisor')) return 'SUPERVISOR';
  if (papeis.includes('promotor')) return 'PROMOTOR';
  return 'VENDEDOR';
}

// Resolução hierárquica de meta (4.1.1): da mais específica para a genérica, 1º match vence.
function resolverMeta(metas, perfil, tipo) {
  const candidatas = metas.filter((m) => m.perfil === perfil && m.tipo_meta === tipo);
  // Sem dimensões cadastradas neste módulo (curva/rota/segmento por usuário), usamos a
  // genérica (todas as dimensões vazias) como fallback final.
  const generica = candidatas.find((m) => !m.curva_cliente && !m.regiao_rota_id && !m.segmento_cobertura);
  return generica || candidatas[0] || null;
}

function nivelPorTetoLimite(valor, teto, limite, menorMelhor) {
  // menorMelhor (ex.: % vencido): EXCELENCIA se <= limite; PADRAO se <= teto; senão ZERADO.
  if (menorMelhor) {
    if (valor <= limite) return 'EXCELENCIA';
    if (valor <= teto) return 'PADRAO';
    return 'ZERADO';
  }
  // maiorMelhor (ex.: % cobertura): EXCELENCIA se >= limite; PADRAO se >= teto; senão ZERADO.
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
    const inicioMes = `${competencia}-01`;
    const [ano, mes] = competencia.split('-').map(Number);
    const fimMes = new Date(ano, mes, 0).toISOString().slice(0, 10); // último dia do mês

    const db = base44.asServiceRole.entities;

    const [vendedores, metas, coberturas, mapTrocas, motivos, apuracoesExistentes] = await Promise.all([
      db.Vendedor.list('', 2000),
      db.MetaComissao.filter({ status: { $in: ['ATIVA', 'EXPERIMENTAL'] } }, '-vigencia_inicio', 1000),
      db.CoberturaStatus.list('', 5000),
      db.MotivoTrocaMapeamento.filter({ ativo: true }, '', 500),
      db.MotivoTroca.list('', 500),
      db.ScorecardApuracao.filter({ competencia }, '', 50000),
    ]);

    const ativos = vendedores.filter((v) => v.status !== 'inativo');
    const nomeMotivo = new Map(motivos.map((m) => [m.id, (m.descricao || '').toUpperCase()]));
    const respMapeada = new Map(); // descricao motivo -> VENDEDOR/EMPRESA
    for (const mp of mapTrocas) {
      const desc = (mp.motivo_descricao || nomeMotivo.get(mp.motivo_id) || '').toUpperCase();
      if (desc) respMapeada.set(desc, mp.responsabilidade);
    }

    const dentroMes = (p) => {
      const d = (p.data_faturamento || p.created_date || '').slice(0, 10);
      return d >= inicioMes && d <= fimMes;
    };

    // ===== Vendas do mês: faturamento, mix e pacotes vendidos por vendedor =====
    const vendas = (await db.Pedido.filter({ tipo: 'venda' }, '-data_faturamento', 30000))
      .filter((p) => !STATUS_CANCELADO.includes(p.status) && dentroMes(p));
    const trocas = (await db.Pedido.filter({ tipo: 'troca' }, '-data_faturamento', 30000))
      .filter((p) => !STATUS_CANCELADO.includes(p.status) && dentroMes(p));

    const totalItensMix = (await db.Produto.list('', 5000)).length || 15;

    const fatPorVend = new Map();      // vendedor_id -> faturamento (R$)
    const pacotesVendPorVend = new Map(); // vendedor_id -> pacotes
    const idsVendaSemQtd = [];
    const vendPorPedido = new Map();
    for (const p of vendas) {
      const vid = p.vendedor_id;
      if (!vid) continue;
      fatPorVend.set(vid, (fatPorVend.get(vid) || 0) + (Number(p.valor_total) || 0));
      vendPorPedido.set(p.id, vid);
      const q = Number(p.qtd_total_itens);
      if (q > 0) pacotesVendPorVend.set(vid, (pacotesVendPorVend.get(vid) || 0) + q);
      else idsVendaSemQtd.push(p.id);
    }

    // Mix: itens distintos vendidos por vendedor (via PedidoItem das vendas do mês)
    const mixPorVend = new Map(); // vendedor_id -> Set(item_id)
    const idsVendas = vendas.map((p) => p.id).filter(Boolean);
    for (const grupo of chunk(idsVendas, 100)) {
      const itens = await db.PedidoItem.filter({ pedido_id: { $in: grupo } }, '', 50000);
      for (const it of itens) {
        const vid = vendPorPedido.get(it.pedido_id);
        if (!vid) continue;
        if (!mixPorVend.has(vid)) mixPorVend.set(vid, new Set());
        if (it.produto_id || it.item_id) mixPorVend.get(vid).add(it.produto_id || it.item_id);
        // completa pacotes para pedidos sem qtd_total_itens
        if (idsVendaSemQtd.includes(it.pedido_id)) {
          const q = Number(it.quantidade) > 0 ? Number(it.quantidade) : 0;
          pacotesVendPorVend.set(vid, (pacotesVendPorVend.get(vid) || 0) + q);
        }
      }
    }

    // ===== Qualidade: pacotes de VENCIDO (responsabilidade VENDEDOR) por vendedor =====
    const vencidoPorVend = new Map(); // vendedor_id -> pacotes vencido
    const vendPorTroca = new Map(trocas.map((p) => [p.id, p.vendedor_id]));
    const idsTroca = trocas.map((p) => p.id).filter(Boolean);
    for (const grupo of chunk(idsTroca, 100)) {
      const itens = await db.PedidoItem.filter({ pedido_id: { $in: grupo } }, '', 50000);
      for (const it of itens) {
        const vid = vendPorTroca.get(it.pedido_id);
        if (!vid) continue;
        const desc = (it.motivo_troca_descricao || (it.motivo_troca_id ? nomeMotivo.get(it.motivo_troca_id) : '') || '').toUpperCase();
        const resp = respMapeada.get(desc);
        if (resp !== 'VENDEDOR') continue; // EMPRESA ou não classificado → fora do cálculo
        const q = Number(it.quantidade) > 0 ? Number(it.quantidade) : 0;
        vencidoPorVend.set(vid, (vencidoPorVend.get(vid) || 0) + q);
      }
    }

    // ===== Cobertura: % de clientes EM_DIA por responsável (Cobertura Inteligente) =====
    const cobPorResp = new Map(); // responsavel_id -> { total, em_dia }
    for (const c of coberturas) {
      const rid = c.responsavel_id;
      if (!rid) continue;
      if (!cobPorResp.has(rid)) cobPorResp.set(rid, { total: 0, em_dia: 0 });
      const o = cobPorResp.get(rid);
      o.total++;
      if (c.status_cobertura === 'em_dia') o.em_dia++;
    }
    // Cobertura agregada da equipe do supervisor (para perfil SUPERVISOR/GERENCIA)
    const idsAtivos = new Set(ativos.map((v) => v.id));

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
      if (perfil === 'VENDEDOR' || perfil === 'PROMOTOR') {
        const o = cobPorResp.get(v.id) || { total: 0, em_dia: 0 };
        cobTotal = o.total; cobEmDia = o.em_dia;
      } else {
        // agrega cobertura dos liderados
        for (const lid of ativos) {
          const subord = lid.supervisor_id === v.id || (lid.supervisor_ids || []).includes(v.id);
          const agregaTudo = perfil === 'GERENCIA';
          if (agregaTudo || subord) {
            const o = cobPorResp.get(lid.id);
            if (o) { cobTotal += o.total; cobEmDia += o.em_dia; }
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

      // Pula quem não tem nenhuma atividade no mês
      if (fatBase <= 0 && cobTotal === 0 && pacotes === 0) continue;

      // ---- Indicadores por bloco ----
      const percVencido = pacotes > 0 ? +((vencido / pacotes) * 100).toFixed(2) : 0;
      const percCobertura = cobTotal > 0 ? +((cobEmDia / cobTotal) * 100).toFixed(2) : 0;
      const percMix = totalItensMix > 0 ? +((itensMix / totalItensMix) * 100).toFixed(2) : 0;
      const valorApurado = { FATURAMENTO: fatBase, QUALIDADE: percVencido, COBERTURA: percCobertura, MIX: percMix };

      for (const bloco of BLOCOS) {
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

    // Persiste (upsert idempotente por usuario+competencia+bloco)
    for (const grupo of chunk(aCriar, 100)) await db.ScorecardApuracao.bulkCreate(grupo);
    for (const item of aAtualizar) { const { id, ...d } = item; await db.ScorecardApuracao.update(id, d); }

    return Response.json({
      ok: true,
      competencia,
      vendedores_apurados: avaliados,
      linhas_criadas: aCriar.length,
      linhas_atualizadas: aAtualizar.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});