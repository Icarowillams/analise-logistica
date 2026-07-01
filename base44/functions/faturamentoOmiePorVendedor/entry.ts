import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

async function resolverCreds(base44) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { app_key: envKey, app_secret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  return { app_key: envKey || ativo?.app_key, app_secret: envSecret || ativo?.app_secret };
}

async function omieListarNF(base44, param) {
  const { app_key, app_secret } = await resolverCreds(base44);
  if (!app_key || !app_secret) throw new Error('Credenciais Omie não configuradas.');
  const url = OMIE_BASE_URL + 'produtos/nfconsultar/';
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ListarNF', app_key, app_secret, param: [param] })
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { data_inicial, data_final, resumo = false, debug_raw = false } = body;

    const t0 = Date.now();

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

    // Mapas de lookup para pedidos locais: omie_codigo_pedido e numero_pedido
    const pedidoByCod = new Map();
    const pedidoByNum = new Map();
    for (const p of pedidos) {
      if (p.omie_codigo_pedido) pedidoByCod.set(String(p.omie_codigo_pedido), p);
      if (p.numero_pedido) pedidoByNum.set(String(p.numero_pedido), p);
    }

    // Vendedor lookup: id -> vendedor (para resolver supervisor)
    const vendedorById = new Map();
    for (const v of vendedores) {
      vendedorById.set(v.id, v);
    }

    // 2) Paginar NFs do Omie no período
    const nfsValidas = [];
    let nfsCanceladas = 0;
    let nfsEntrada = 0;  // tpNF=0 — não são vendas, não entram no faturamento
    let pg = 1;
    let totalPaginas = 1;
    const MAX_PAGINAS = 50;
    do {
      const d = await omieListarNF(base44, {
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
        // Filtro: apenas autorizadas (100/135), excluir canceladas
        if (cStat === '101' || dCan) { nfsCanceladas++; continue; }
        if (cStat && cStat !== '100' && cStat !== '135') continue;

        // Filtro: apenas SAÍDA (tpNF=1). tpNF=0 = Entrada (compras, devoluções) — não é venda.
        const tpNF = String(nf.ide?.tpNF || '');
        if (tpNF === '0') { nfsEntrada++; continue; }

        const nIdPedido = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
        const cNumero = String(nf.ide?.nNF || nf.cNumero || '');
        const valor = nf.total?.ICMSTot?.vNF || nf.nValorNF || 0;
        const modelo = String(nf.ide?.modelo || nf.ide?.cModelo || nf.ide?.mod || '');

        nfsValidas.push({ nIdPedido, cNumero, valor, modelo, tpNF, _rawIde: debug_raw ? nf.ide : null, _rawTipo: debug_raw ? nf.tipo_nota : null });
      }
      pg++;
    } while (pg <= totalPaginas && pg <= MAX_PAGINAS);

    // 3) Matching: cruzar NFs com espelhos/pedidos para achar vendedor
    const porVendedor = {};
    let naoIdQtd = 0, naoIdValor = 0, totalFaturado = 0;
    const amostraNaoIdSem = [];
    const amostraNaoIdCom = [];
    const amostraRawIde = []; // debug: raw ide object of first few unidentified NFs
    let naoIdSemNIdPedido = 0;
    let naoIdComNIdPedido = 0;
    let naoIdEntrada = 0;  // tpNF=0 (Entrada) — não são vendas

    for (const nf of nfsValidas) {
      totalFaturado += nf.valor;

      // Tentar match no espelho (primário) por nIdPedido ou cNumero
      let vendedorId = '', vendedorNome = '';
      let esp = espelhoByCod.get(nf.nIdPedido) || espelhoByNum.get(nf.cNumero);
      if (esp) {
        vendedorId = esp.vendedor_id || '';
        vendedorNome = esp.vendedor_nome || '';
      } else {
        // Fallback: Pedido local por omie_codigo_pedido ou numero_pedido
        const ped = pedidoByCod.get(nf.nIdPedido) || pedidoByNum.get(nf.cNumero);
        if (ped) {
          vendedorId = ped.vendedor_id || '';
          vendedorNome = ped.vendedor_nome || '';
        }
      }

      // Resolver supervisor via entidade Vendedor
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

      if (!vendedorNome) {
        naoIdQtd++; naoIdValor += nf.valor;
        if (nf.tpNF === '0') naoIdEntrada++;
        const amostraItem = { nIdPedido: nf.nIdPedido || '(vazio)', cNumero: nf.cNumero, valor: nf.valor, modelo: nf.modelo || '?', tpNF: nf.tpNF || '?' };
        if (debug_raw && amostraRawIde.length < 3) amostraRawIde.push({ ide: nf._rawIde, tipo_nota: nf._rawTipo, cNumero: nf.cNumero, nIdPedido: nf.nIdPedido });
        if (nf.nIdPedido) {
          naoIdComNIdPedido++;
          if (amostraNaoIdCom.length < 15) amostraNaoIdCom.push(amostraItem);
        } else {
          naoIdSemNIdPedido++;
          if (amostraNaoIdSem.length < 3) amostraNaoIdSem.push(amostraItem);
        }
        vendedorNome = '(vendedor não identificado)';
        supervisorNome = '(sem supervisor definido)';
      }

      const key = vendedorNome + '||' + supervisorNome;
      if (!porVendedor[key]) {
        porVendedor[key] = { vendedor_nome: vendedorNome, supervisor_nome: supervisorNome, valor: 0, qtd_nfs: 0 };
      }
      porVendedor[key].valor += nf.valor;
      porVendedor[key].qtd_nfs++;
    }

    const porVendedorArr = Object.values(porVendedor).sort((a, b) => b.valor - a.valor);

    return Response.json({
      periodo: `${data_inicial} a ${data_final}`,
      fonte: 'OMIE (NF autorizada)',
      total_faturado_omie: Math.round(totalFaturado * 100) / 100,
      nfs_validas: nfsValidas.length,
      nfs_canceladas: nfsCanceladas,
      nfs_entrada_tpNF0: nfsEntrada,
      nao_identificados: { qtd_nfs: naoIdQtd, valor: Math.round(naoIdValor * 100) / 100 },
      nao_id_sem_nIdPedido: naoIdSemNIdPedido,
      nao_id_com_nIdPedido: naoIdComNIdPedido,
      nao_id_entrada_tpNF0: naoIdEntrada,
      total_paginas_omie: totalPaginas,
      paginas_processadas: pg - 1,
      duracao_ms: Date.now() - t0,
      amostra_nao_id_sem_nIdPedido: amostraNaoIdSem,
      amostra_nao_id_com_nIdPedido: amostraNaoIdCom,
      ...(debug_raw ? { debug_raw_ide: amostraRawIde } : {}),
      ...(resumo ? {} : { por_vendedor: porVendedorArr })
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});