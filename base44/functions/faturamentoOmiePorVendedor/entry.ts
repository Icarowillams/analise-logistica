import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

// ID fixo do vendedor institucional "APLICATIVO"
const ID_APLICATIVO = '69ff70a75fbcb49b6597113a';

async function resolverCreds(base44) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { app_key: envKey, app_secret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  return { app_key: envKey || ativo?.app_key, app_secret: envSecret || ativo?.app_secret };
}

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

function normDoc(doc) {
  return String(doc || '').replace(/\D/g, '');
}

function normNome(nome) {
  return String(nome || '').trim().toUpperCase();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { data_inicial, data_final, resumo = false, compacto = false, pular_vendedores = 0 } = body;

    const t0 = Date.now();
    const creds = await resolverCreds(base44);
    if (!creds.app_key || !creds.app_secret) throw new Error('Credenciais Omie não configuradas.');

    // 1) Carregar espelhos, pedidos locais e vendedores em paralelo
    const [espelhos, pedidos, vendedores] = await Promise.all([
      base44.asServiceRole.entities.PedidoLiberadoOmie.list('-updated_date', 5000).catch(() => []),
      base44.asServiceRole.entities.Pedido.list('-updated_date', 5000).catch(() => []),
      base44.asServiceRole.entities.Vendedor.list('-updated_date', 1000).catch(() => [])
    ]);

    // Mapas de lookup para espelhos: codigo_pedido (nIdPedido) e numero_pedido (cNumero)
    const espelhoByCod = new Map();
    const espelhoByNum = new Map();
    for (const e of espelhos) {
      if (e.codigo_pedido) espelhoByCod.set(String(e.codigo_pedido), e);
      if (e.numero_pedido) espelhoByNum.set(String(e.numero_pedido), e);
    }

    // Mapas de lookup para pedidos locais
    const pedidoByCod = new Map();
    const pedidoByNum = new Map();
    for (const p of pedidos) {
      if (p.omie_codigo_pedido) pedidoByCod.set(String(p.omie_codigo_pedido), p);
      if (p.numero_pedido) pedidoByNum.set(String(p.numero_pedido), p);
    }

    // Vendedor lookup: id -> vendedor e nome normalizado -> vendedor
    const vendedorById = new Map();
    const vendedorByNome = new Map();
    for (const v of vendedores) {
      vendedorById.set(v.id, v);
      const nomeNorm = normNome(v.nome);
      if (nomeNorm) vendedorByNome.set(nomeNorm, v);
    }

    // 2) Paginar NFs do Omie no período
    const CFOP_VENDA = new Set(['5405', '6404']);
    const CFOP_BONIFICACAO = new Set(['5910', '6910']);
    const normCfop = (c) => String(c || '').replace(/\D/g, '');

    const nfsValidas = [];
    let nfsCanceladas = 0;
    let nfsEntrada = 0;
    let pg = 1;
    let totalPaginas = 1;
    const MAX_PAGINAS = 50;
    do {
      const d = await omieListarNF(creds, {
        pagina: pg,
        registros_por_pagina: 100,
        dEmiInicial: data_inicial,
        dEmiFinal: data_final,
        ordenar_por: 'NUMERO',
        ordem_decrescente: 'S'
      });
      totalPaginas = d.nTotPaginas || d.total_de_paginas || 1;
      for (const nf of (d.nfCadastro || [])) {
        const cStat = String(nf.nfStatus?.cStat || nf.compl?.cStat || '').trim();
        const dCan = nf.ide?.dCan ? String(nf.ide.dCan).trim() : '';
        if (cStat === '101' || dCan) { nfsCanceladas++; continue; }
        if (cStat && cStat !== '100' && cStat !== '135') continue;

        const tpNF = String(nf.ide?.tpNF || '');
        if (tpNF === '0') { nfsEntrada++; continue; }

        const nIdPedido = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
        const cNumero = String(nf.ide?.nNF || nf.cNumero || '');

        const itensRaw = nf.itens || nf.det || [];
        const itens = Array.isArray(itensRaw) ? itensRaw : (itensRaw.item || []);
        let valorVenda = 0;
        let valorBonificacao = 0;
        for (const it of itens) {
          const prod = it.prod || it.produto || it;
          const cfopNorm = normCfop(prod.CFOP || prod.cfop);
          if (!cfopNorm) continue;
          const vItem = prod.vProd || prod.vTotItem || ((prod.qCom || 0) * (prod.vUnCom || 0)) || 0;
          if (CFOP_VENDA.has(cfopNorm)) {
            valorVenda += vItem;
          } else if (CFOP_BONIFICACAO.has(cfopNorm)) {
            valorBonificacao += vItem;
          }
        }

        if (itens.length === 0) {
          valorVenda = nf.total?.ICMSTot?.vNF || nf.nValorNF || 0;
        }

        nfsValidas.push({ nIdPedido, cNumero, valorVenda, valorBonificacao });
      }
      pg++;
    } while (pg <= totalPaginas && pg <= MAX_PAGINAS);

    // 3) Matching: vendedor do PEDIDO (espelho ou pedido local) — única fonte de verdade
    //    Se vendedor_id estiver vazio mas vendedor_nome existir, resolver por nome na entidade Vendedor.
    //    NÃO usar vendedor do cadastro do cliente (causa 31% de erro — comissão atribuída ao vendedor
    //    responsável pelo cliente, não a quem executou a venda).
    const porVendedor = {};
    const porSupervisor = {};
    let naoIdQtd = 0, naoIdValor = 0;
    let totalVenda = 0;
    let totalBonificacao = 0;
    let totalInstitucional = 0;
    let qtdNfsComVenda = 0;
    const amostraNaoId = [];

    for (const nf of nfsValidas) {
      totalBonificacao += nf.valorBonificacao;
      if (nf.valorVenda <= 0) continue;
      qtdNfsComVenda++;
      totalVenda += nf.valorVenda;

      let vendedorId = '';
      let vendedorNome = '';

      // Fonte primária: espelho (vendedor capturado no Pedido do Omie)
      const esp = espelhoByCod.get(nf.nIdPedido) || espelhoByNum.get(nf.cNumero);
      if (esp) {
        vendedorId = esp.vendedor_id || '';
        vendedorNome = esp.vendedor_nome || '';
      }

      // Fonte secundária: Pedido local
      if (!vendedorId && !vendedorNome) {
        const ped = pedidoByCod.get(nf.nIdPedido) || pedidoByNum.get(nf.cNumero);
        if (ped) {
          vendedorId = ped.vendedor_id || '';
          vendedorNome = ped.vendedor_nome || '';
        }
      }

      // Resolver vendedor_id por nome quando o espelho/pedido trouxe o nome mas não o ID
      if (!vendedorId && vendedorNome) {
        const vend = vendedorByNome.get(normNome(vendedorNome));
        if (vend) vendedorId = vend.id;
      }

      // Resolver supervisor
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

      // Se não identificou vendedor nem por ID nem por nome → não identificado
      if (!vendedorId && !vendedorNome) {
        naoIdQtd++;
        naoIdValor += nf.valorVenda;
        if (amostraNaoId.length < 15) {
          amostraNaoId.push({
            nIdPedido: nf.nIdPedido || '(vazio)',
            cNumero: nf.cNumero,
            valor: Math.round(nf.valorVenda * 100) / 100
          });
        }
        vendedorNome = '(vendedor não identificado)';
        supervisorNome = '(sem supervisor definido)';
      } else if (!vendedorId) {
        // Tem nome mas não resolveu ID — não consegue achar supervisor
        supervisorNome = '(sem supervisor definido)';
      }

      const isInstitucional = vendedorId === ID_APLICATIVO;
      if (isInstitucional) totalInstitucional += nf.valorVenda;

      const key = vendedorNome + '||' + supervisorNome;
      if (!porVendedor[key]) {
        porVendedor[key] = { vendedor_nome: vendedorNome, supervisor_nome: supervisorNome, vendedor_id: vendedorId, valor: 0, qtd_nfs: 0 };
      }
      porVendedor[key].valor += nf.valorVenda;
      porVendedor[key].qtd_nfs++;

      const supKey = supervisorNome || '(sem supervisor definido)';
      if (!porSupervisor[supKey]) {
        porSupervisor[supKey] = { supervisor_nome: supKey, valor: 0, qtd_nfs: 0 };
      }
      porSupervisor[supKey].valor += nf.valorVenda;
      porSupervisor[supKey].qtd_nfs++;
    }

    const totalComissionavel = totalVenda - totalInstitucional;

    const porVendedorArr = Object.values(porVendedor).map(v => ({ ...v, valor: Math.round(v.valor * 100) / 100 })).sort((a, b) => b.valor - a.valor);
    const porSupervisorArr = Object.values(porSupervisor).map(s => ({ ...s, valor: Math.round(s.valor * 100) / 100 })).sort((a, b) => b.valor - a.valor);

    if (compacto) {
      const supAgg = {};
      for (const v of porVendedorArr) {
        if (!v.vendedor_id || v.vendedor_id === ID_APLICATIVO) continue;
        const sName = v.supervisor_nome || '(sem supervisor)';
        if (!supAgg[sName]) supAgg[sName] = { valor: 0, vendedores: new Set() };
        supAgg[sName].valor += v.valor;
        supAgg[sName].vendedores.add(v.vendedor_nome);
      }
      const porSupCompacto = Object.entries(supAgg)
        .map(([s, d]) => ({ s, v: Math.round(d.valor * 100) / 100, q: d.vendedores.size }))
        .sort((a, b) => b.v - a.v);

      return Response.json({
        total_venda_comissionavel: Math.round(totalComissionavel * 100) / 100,
        total_institucional_aplicativo: Math.round(totalInstitucional * 100) / 100,
        total_bonificacao: Math.round(totalBonificacao * 100) / 100,
        nao_identificados: { qtd: naoIdQtd, valor: Math.round(naoIdValor * 100) / 100 },
        por_vendedor: porVendedorArr.slice(pular_vendedores).map(v => ({ n: v.vendedor_nome, v: v.valor, s: v.supervisor_nome })),
        por_supervisor: porSupCompacto,
        total_vendedores: porVendedorArr.length
      });
    }

    return Response.json({
      periodo: `${data_inicial} a ${data_final}`,
      fonte: 'OMIE (NF autorizada, CFOP 5.405/6.404 = venda; vendedor do PEDIDO)',
      total_venda_omie: Math.round(totalVenda * 100) / 100,
      total_venda_comissionavel: Math.round(totalComissionavel * 100) / 100,
      total_institucional_aplicativo: Math.round(totalInstitucional * 100) / 100,
      total_bonificacao: Math.round(totalBonificacao * 100) / 100,
      qtd_nfs_venda: qtdNfsComVenda,
      nfs_validas: nfsValidas.length,
      nfs_canceladas: nfsCanceladas,
      nfs_entrada_tpNF0: nfsEntrada,
      nao_identificados: { qtd_nfs: naoIdQtd, valor: Math.round(naoIdValor * 100) / 100 },
      total_paginas_omie: totalPaginas,
      paginas_processadas: pg - 1,
      duracao_ms: Date.now() - t0,
      amostra_nao_identificados: amostraNaoId,
      ...(resumo ? {} : { por_vendedor: porVendedorArr, por_supervisor: porSupervisorArr })
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});