import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const ID_APLICATIVO = '69ff70a75fbcb49b6597113a';
const STALE_MS = 10 * 60 * 1000; // 10 min
const LOCK_TTL_MS = 3 * 60 * 1000; // 3 min
const BULK_SIZE = 500;

// ─── Credenciais ───────────────────────────────────────────────────────────
async function resolverCreds(base44) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { app_key: envKey, app_secret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  return { app_key: envKey || ativo?.app_key, app_secret: envSecret || ativo?.app_secret };
}

// ─── Chamada Omie (retry 425/429/5xx) ───────────────────────────────────────
async function omieListarNF(creds, param) {
  const url = OMIE_BASE_URL + 'produtos/nfconsultar/';
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ListarNF', app_key: creds.app_key, app_secret: creds.app_secret, param: [param] })
    });
    if (res.status >= 500 || res.status === 429 || res.status === 425) {
      const corpo = await res.text().catch(() => '');
      lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
      if (res.status === 425) throw new Error(lastErr);
      if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
    const data = await res.json();
    if (data.faultstring) throw new Error(data.faultstring);
    return data;
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}

// ─── Utils ──────────────────────────────────────────────────────────────────
function normDoc(doc) { return String(doc || '').replace(/\D/g, ''); }
function normNome(nome) { return String(nome || '').trim().toUpperCase(); }

// DD/MM/AAAA → AAAA-MM-DD
function isoDate(dtBr) {
  const s = String(dtBr || '');
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10);
}

// AAAA-MM-DD → DD/MM/AAAA
function brDate(iso) {
  const s = String(iso || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nowISO() { return new Date().toISOString(); }

const CFOP_VENDA = new Set(['5405', '6404']);
const CFOP_BONIFICACAO = new Set(['5910', '6910']);
const normCfop = (c) => String(c || '').replace(/\D/g, '');

function derivarStatus(nf) {
  const ide = nf.ide || {};
  const compl = nf.compl || {};
  const nfStatus = nf.nfStatus || {};
  const cStat = String(nfStatus.cStat || compl.cStat || '').trim();
  if (cStat) {
    if (cStat === '101') return 'cancelada';
    if (cStat === '102') return 'inutilizada';
    if (cStat === '110' || cStat === '301' || cStat === '302') return 'denegada';
    if (cStat === '100' || cStat === '135') return 'autorizada';
    return 'rejeitada';
  }
  if (ide.dCan && String(ide.dCan).trim()) return 'cancelada';
  if (ide.cDeneg === 'S' || ide.cDeneg === 'D') return 'denegada';
  if (ide.dInut && String(ide.dInut).trim()) return 'inutilizada';
  if (compl.cChaveNFe && String(compl.cChaveNFe).length >= 40) return 'autorizada';
  return 'pendente';
}

// ─── Processar UMA NF do Omie → objeto do espelho ───────────────────────────
function processarNF(nf, mapas) {
  const { espelhoByCod, espelhoByNum, pedidoByCod, pedidoByNum, vendedorById, vendedorByNome } = mapas;

  const nIdNF = String(nf.compl?.nIdNF || nf.nIdNF || nf.nCodNF || '');
  if (!nIdNF) return null;

  const cNumero = String(nf.ide?.nNF || nf.cNumero || '');
  const cSerie = String(nf.ide?.serie || nf.cSerie || '');
  const cChaveNFe = String(nf.compl?.cChaveNFe || nf.cChaveNFe || '');
  const dEmi = nf.ide?.dEmi || nf.dEmiNF || '';
  const hEmi = nf.ide?.hEmi || nf.hEmiNF || '';
  const status = derivarStatus(nf);
  const cancelada = status === 'cancelada' || !!(nf.ide?.dCan && String(nf.ide.dCan).trim());
  const tpNF = Number(nf.ide?.tpNF || 0);

  // Filtro: só saídas (tpNF=1). Entradas (tpNF=0 = compra de fornecedor) não interessam.
  if (tpNF === 0) return null;

  // Itens → somar por CFOP
  const itensRaw = nf.itens || nf.det || [];
  const itens = Array.isArray(itensRaw) ? itensRaw : (itensRaw.item || []);
  let valorVenda = 0;
  let valorBonificacao = 0;
  let cfopPrincipal = '';
  for (const it of itens) {
    const prod = it.prod || it.produto || it;
    const cfopNorm = normCfop(prod.CFOP || prod.cfop);
    if (!cfopNorm) continue;
    const vItem = prod.vProd || prod.vTotItem || ((prod.qCom || 0) * (prod.vUnCom || 0)) || 0;
    if (CFOP_VENDA.has(cfopNorm)) {
      valorVenda += vItem;
      if (!cfopPrincipal) cfopPrincipal = cfopNorm;
    } else if (CFOP_BONIFICACAO.has(cfopNorm)) {
      valorBonificacao += vItem;
      if (!cfopPrincipal) cfopPrincipal = cfopNorm;
    }
  }
  if (itens.length === 0) {
    valorVenda = nf.total?.ICMSTot?.vNF || nf.nValorNF || 0;
  }

  const valorTotalNF = nf.total?.ICMSTot?.vNF || nf.nValorNF || 0;

  // Tipo
  let tipo = 'outro';
  if (valorVenda > 0) tipo = 'venda';
  else if (valorBonificacao > 0) tipo = 'bonificacao';

  // Cruzamento NF → pedido → vendedor/rota/cliente/forma_pagamento
  const nIdPedido = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
  let vendedorId = '';
  let vendedorNome = '';
  let clienteId = '';
  let clienteNome = '';
  let rotaId = '';
  let rotaNome = '';
  let formaPagamento = '';

  // Fonte primária: espelho
  const esp = espelhoByCod.get(nIdPedido) || espelhoByNum.get(cNumero);
  if (esp) {
    vendedorId = esp.vendedor_id || '';
    vendedorNome = esp.vendedor_nome || '';
    clienteId = esp.cliente_id || '';
    clienteNome = esp.nome_cliente || esp.nome_fantasia || '';
    rotaId = esp.rota_id || '';
    rotaNome = esp.rota_nome || '';
  }

  // Fonte secundária: Pedido local
  if (!vendedorId && !vendedorNome && !clienteId) {
    const ped = pedidoByCod.get(nIdPedido) || pedidoByNum.get(cNumero);
    if (ped) {
      vendedorId = ped.vendedor_id || '';
      vendedorNome = ped.vendedor_nome || '';
      clienteId = ped.cliente_id || '';
      clienteNome = ped.cliente_nome || '';
      rotaId = ped.rota_id || '';
      rotaNome = ped.rota_nome || '';
      formaPagamento = ped.plano_pagamento_nome || '';
    }
  }

  // Sempre buscar forma_pagamento no Pedido local (o espelho Omie não tem este campo).
  // Re-buscado a cada sync pra preencher linhas já existentes quando o vínculo aparece.
  if (!formaPagamento) {
    const ped = pedidoByCod.get(nIdPedido) || pedidoByNum.get(cNumero);
    if (ped) formaPagamento = ped.plano_pagamento_nome || '';
  }

  // Resolver vendedor_id por nome
  if (!vendedorId && vendedorNome) {
    const vend = vendedorByNome.get(normNome(vendedorNome));
    if (vend) vendedorId = vend.id;
  }

  // Supervisor
  let supervisorNome = '';
  if (vendedorId) {
    const vend = vendedorById.get(vendedorId);
    if (vend) {
      if (!vendedorNome) vendedorNome = vend.nome;
      const supId = vend.supervisor_id || vend.supervisor_ids?.[0];
      if (supId) {
        const sup = vendedorById.get(supId);
        if (sup) supervisorNome = sup.nome;
      }
    }
  }

  // Cliente do destinatário da NF (fallback se não veio do pedido)
  if (!clienteNome) clienteNome = nf.nfDestInt?.cRazao || nf.cRazao || '';
  const cnpjCpf = normDoc(nf.nfDestInt?.cnpj_cpf || nf.cCPFCNPJDest);

  // Institucional?
  const isInstitucional = vendedorId === ID_APLICATIVO;
  if (isInstitucional && tipo === 'venda') tipo = 'institucional';

  // Comissionável: venda (não institucional) + vendedor identificado + não cancelada
  const comissionavel = !cancelada && tipo === 'venda' && !!vendedorId && vendedorId !== ID_APLICATIVO;

  return {
    nid_nf: nIdNF,
    numero_nf: cNumero,
    serie: cSerie,
    chave_nfe: cChaveNFe,
    data_emissao: isoDate(dEmi),
    hora_emissao: hEmi || '',
    cancelada,
    status,
    tp_nf: tpNF,
    tipo,
    cfop_principal: cfopPrincipal,
    valor_total_nf: Math.round(valorTotalNF * 100) / 100,
    valor_venda: Math.round(valorVenda * 100) / 100,
    valor_bonificacao: Math.round(valorBonificacao * 100) / 100,
    codigo_pedido: nIdPedido,
    cliente_id: clienteId,
    cliente_nome: clienteNome,
    cnpj_cpf: cnpjCpf,
    vendedor_nome: vendedorNome,
    vendedor_id: vendedorId,
    supervisor_nome: supervisorNome,
    rota_id: rotaId,
    rota_nome: rotaNome,
    forma_pagamento: formaPagamento,
    comissionavel,
    sincronizado_em: nowISO()
  };
}

// ─── Quebrar período longo em blocos de ~15 dias ────────────────────────────
function gerarBlocos(inicioISO, fimISO) {
  const blocos = [];
  let atual = inicioISO;
  while (atual <= fimISO) {
    let fimBloco = addDays(atual, 14); // 15 dias (0-14)
    if (fimBloco > fimISO) fimBloco = fimISO;
    blocos.push({ inicio: atual, fim: fimBloco });
    atual = addDays(fimBloco, 1);
  }
  return blocos;
}

// ─── Handler principal ──────────────────────────────────────────────────────
Deno.serve(async (req) => {
  let base44;
  let periodoChave;
  let controleId;
  let lockAdquirido = false;

  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { data_inicial, data_final, forcar = false } = body;
    if (!data_inicial || !data_final) {
      return Response.json({ error: 'data_inicial e data_final são obrigatórios (DD/MM/AAAA)' }, { status: 400 });
    }

    const inicioISO = isoDate(data_inicial);
    const fimISO = isoDate(data_final);
    periodoChave = `${inicioISO}_${fimISO}`;
    const agora = nowISO();

    // 1) Stale check + Lock
    const controles = await base44.asServiceRole.entities.ControleSyncFaturamento.filter({ periodo_chave: periodoChave }, '-updated_date', 1).catch(() => []);
    const controle = controles?.[0];

    if (controle) {
      controleId = controle.id;

      // Já atualizado?
      if (!forcar && controle.ultima_sincronizacao) {
        const ultima = new Date(controle.ultima_sincronizacao).getTime();
        if (agora && (Date.now() - ultima < STALE_MS)) {
          return Response.json({ ja_atualizado: true, ultima_sincronizacao: controle.ultima_sincronizacao, total_nfs_sincronizadas: controle.total_nfs_sincronizadas || 0 });
        }
      }

      // Lock em andamento?
      if (controle.em_andamento && controle.lock_ate) {
        const lockAte = new Date(controle.lock_ate).getTime();
        if (lockAte > Date.now()) {
          return Response.json({ em_andamento: true, lock_ate: controle.lock_ate });
        }
      }

      // Adquirir lock
      await base44.asServiceRole.entities.ControleSyncFaturamento.update(controle.id, {
        em_andamento: true,
        lock_ate: new Date(Date.now() + LOCK_TTL_MS).toISOString()
      });
      lockAdquirido = true;
    } else {
      // Criar controle
      const novo = await base44.asServiceRole.entities.ControleSyncFaturamento.create({
        periodo_chave: periodoChave,
        em_andamento: true,
        lock_ate: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
        total_nfs_sincronizadas: 0
      });
      controleId = novo.id;
      lockAdquirido = true;
    }

    const t0 = Date.now();
    const creds = await resolverCreds(base44);
    if (!creds.app_key || !creds.app_secret) throw new Error('Credenciais Omie não configuradas.');

    // 2) Carregar dados locais para cruzamento (paralelo)
    const [espelhos, pedidos, vendedores] = await Promise.all([
      base44.asServiceRole.entities.PedidoLiberadoOmie.list('-updated_date', 5000).catch(() => []),
      base44.asServiceRole.entities.Pedido.list('-updated_date', 5000).catch(() => []),
      base44.asServiceRole.entities.Vendedor.list('-updated_date', 1000).catch(() => [])
    ]);

    const espelhoByCod = new Map();
    const espelhoByNum = new Map();
    for (const e of espelhos) {
      if (e.codigo_pedido) espelhoByCod.set(String(e.codigo_pedido), e);
      if (e.numero_pedido) espelhoByNum.set(String(e.numero_pedido), e);
    }
    const pedidoByCod = new Map();
    const pedidoByNum = new Map();
    for (const p of pedidos) {
      if (p.omie_codigo_pedido) pedidoByCod.set(String(p.omie_codigo_pedido), p);
      if (p.numero_pedido) pedidoByNum.set(String(p.numero_pedido), p);
    }
    const vendedorById = new Map();
    const vendedorByNome = new Map();
    for (const v of vendedores) {
      vendedorById.set(v.id, v);
      const nomeNorm = normNome(v.nome);
      if (nomeNorm) vendedorByNome.set(nomeNorm, v);
    }
    const mapas = { espelhoByCod, espelhoByNum, pedidoByCod, pedidoByNum, vendedorById, vendedorByNome };

    // 3) Puxar NFs do Omie (blocos se período > 16 dias)
    const dias = Math.round((new Date(fimISO + 'T00:00:00Z').getTime() - new Date(inicioISO + 'T00:00:00Z').getTime()) / 86400000) + 1;
    const blocos = dias > 16 ? gerarBlocos(inicioISO, fimISO) : [{ inicio: inicioISO, fim: fimISO }];

    const nfsProcessadas = [];
    for (const bloco of blocos) {
      let pg = 1;
      let totalPaginas = 1;
      const MAX_PAGINAS = 50;
      do {
        const d = await omieListarNF(creds, {
          pagina: pg,
          registros_por_pagina: 100,
          dEmiInicial: brDate(bloco.inicio),
          dEmiFinal: brDate(bloco.fim),
          ordenar_por: 'NUMERO',
          ordem_decrescente: 'S'
        });
        totalPaginas = d.nTotPaginas || d.total_de_paginas || 1;
        for (const nf of (d.nfCadastro || [])) {
          const processada = processarNF(nf, mapas);
          if (processada) nfsProcessadas.push(processada);
        }
        pg++;
      } while (pg <= totalPaginas && pg <= MAX_PAGINAS);
    }

    // 4) Upsert por nid_nf (idempotente) — RE-CRUZA vendedor a cada sync (campos derivados atualizados)
    //    Buscar NFs existentes do período para mapear nid_nf → id
    const existentes = await base44.asServiceRole.entities.EspelhoFaturamentoNF.filter({ data_emissao: { $gte: inicioISO, $lte: fimISO } }, '-updated_date', 5000).catch(() => []);
    const existenteByNid = new Map();
    for (const e of existentes) {
      if (e.nid_nf) existenteByNid.set(String(e.nid_nf), e);
    }

    // Também buscar por nid_nf das que podem não estar no range de data (edge: data mudou)
    const nidsNovos = nfsProcessadas.filter(n => !existenteByNid.has(n.nid_nf)).map(n => n.nid_nf);
    if (nidsNovos.length > 0) {
      // Buscar em lotes pelos nids não encontrados
      for (let i = 0; i < nidsNovos.length; i += 100) {
        const chunk = nidsNovos.slice(i, i + 100);
        const encontrados = await base44.asServiceRole.entities.EspelhoFaturamentoNF.filter({ nid_nf: { $in: chunk } }, '-updated_date', 500).catch(() => []);
        for (const e of encontrados) {
          if (e.nid_nf) existenteByNid.set(String(e.nid_nf), e);
        }
      }
    }

    const paraAtualizar = [];
    const paraCriar = [];
    for (const nf of nfsProcessadas) {
      const exist = existenteByNid.get(nf.nid_nf);
      if (exist) {
        paraAtualizar.push({ id: exist.id, ...nf });
      } else {
        paraCriar.push(nf);
      }
    }

    // Bulk update (lotes de 500) — atualiza TODOS os campos derivados
    let totalUpsert = 0;
    for (let i = 0; i < paraAtualizar.length; i += BULK_SIZE) {
      const chunk = paraAtualizar.slice(i, i + BULK_SIZE);
      await base44.asServiceRole.entities.EspelhoFaturamentoNF.bulkUpdate(chunk);
      totalUpsert += chunk.length;
    }
    for (let i = 0; i < paraCriar.length; i += BULK_SIZE) {
      const chunk = paraCriar.slice(i, i + BULK_SIZE);
      await base44.asServiceRole.entities.EspelhoFaturamentoNF.bulkCreate(chunk);
      totalUpsert += chunk.length;
    }

    // 5) Agregar totais (SÓ não-canceladas)
    let comissionavel = 0;
    let institucional = 0;
    let bonificacao = 0;
    let naoIdQtd = 0;
    let naoIdValor = 0;
    let canceladasQtd = 0;
    let canceladasValor = 0;
    for (const nf of nfsProcessadas) {
      if (nf.cancelada) {
        canceladasQtd++;
        canceladasValor += nf.valor_venda;
        continue;
      }
      if (nf.tipo === 'institucional') {
        institucional += nf.valor_venda;
      } else if (nf.tipo === 'bonificacao') {
        bonificacao += nf.valor_bonificacao;
      } else if (nf.tipo === 'venda') {
        if (nf.comissionavel) {
          comissionavel += nf.valor_venda;
        } else {
          // Venda não comissionável = não identificado (sem vendedor)
          naoIdQtd++;
          naoIdValor += nf.valor_venda;
        }
      }
    }

    // 6) Liberar lock + atualizar controle
    await base44.asServiceRole.entities.ControleSyncFaturamento.update(controleId, {
      ultima_sincronizacao: agora,
      total_nfs_sincronizadas: totalUpsert,
      em_andamento: false,
      lock_ate: null
    });
    lockAdquirido = false;

    // Log
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/nfconsultar',
      call: 'ListarNF',
      operacao: 'sincronizar_espelho_faturamento',
      status: 'sucesso',
      duracao_ms: Date.now() - t0,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      total_nfs: nfsProcessadas.length,
      comissionavel: Math.round(comissionavel * 100) / 100,
      institucional: Math.round(institucional * 100) / 100,
      bonificacao: Math.round(bonificacao * 100) / 100,
      nao_identificados: { qtd: naoIdQtd, valor: Math.round(naoIdValor * 100) / 100 },
      canceladas: { qtd: canceladasQtd, valor: Math.round(canceladasValor * 100) / 100 },
      upserts: { atualizados: paraAtualizar.length, criados: paraCriar.length },
      sincronizado_em: agora,
      duracao_ms: Date.now() - t0
    });

  } catch (error) {
    // Liberar lock no erro
    if (lockAdquirido && controleId && base44) {
      try {
        await base44.asServiceRole.entities.ControleSyncFaturamento.update(controleId, {
          em_andamento: false,
          lock_ate: null
        });
      } catch { /* ignore */ }
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
});