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

// Fallback: ConsultarPedido no Omie — retorna codigo_cliente para match local
// Best-effort: 1 retry, timeout 12s, não pode travar a função
async function omieConsultarPedido(creds, codigo_pedido) {
  const url = OMIE_BASE_URL + 'produtos/pedido/';
  const RETRIES = [2000];
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call: 'ConsultarPedido', app_key: creds.app_key, app_secret: creds.app_secret, param: [{ codigo_pedido: Number(codigo_pedido) }] }),
        signal: controller.signal
      });
      clearTimeout(tid);
      if (res.status >= 500 || res.status === 429) {
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        return null;
      }
      const data = await res.json().catch(() => null);
      if (!data || data.faultstring) return null;
      return data.pedido_venda_produto || null;
    } catch (e) {
      if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      return null;
    }
  }
  return null;
}

// Normaliza CNPJ/CPF: remove tudo que não for dígito
function normDoc(doc) {
  return String(doc || '').replace(/\D/g, '');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { data_inicial, data_final, resumo = false, debug_raw = false, debug_structure = false } = body;

    const t0 = Date.now();
    const creds = await resolverCreds(base44);
    if (!creds.app_key || !creds.app_secret) throw new Error('Credenciais Omie não configuradas.');

    // 1) Carregar espelhos, pedidos locais, vendedores e clientes em paralelo
    const [espelhos, pedidos, vendedores, clientes] = await Promise.all([
      base44.asServiceRole.entities.PedidoLiberadoOmie.list('-updated_date', 5000).catch(() => []),
      base44.asServiceRole.entities.Pedido.list('-updated_date', 5000).catch(() => []),
      base44.asServiceRole.entities.Vendedor.list('-updated_date', 1000).catch(() => []),
      base44.asServiceRole.entities.Cliente.list('-updated_date', 5000).catch(() => [])
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

    // Cliente lookup por CNPJ/CPF normalizado → vendedor_id
    const clienteByDoc = new Map();
    // Cliente lookup por codigo_cliente_omie → cliente (para fallback ConsultarPedido)
    const clienteByCodOmie = new Map();
    for (const c of clientes) {
      const doc = normDoc(c.cnpj_cpf);
      if (doc) clienteByDoc.set(doc, c);
      if (c.codigo_cliente_omie) clienteByCodOmie.set(String(c.codigo_cliente_omie), c);
    }

    // 2) Paginar NFs do Omie no período
    // CFOPs de VENDA (entram na comissão): 5.405 (interno) e 6.404 (interestadual)
    // CFOPs de BONIFICAÇÃO (não entram): 5.910 e 6.910
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
        const modelo = String(nf.ide?.modelo || nf.ide?.cModelo || nf.ide?.mod || '');

        // Extrair CNPJ/CPF e código do cliente do destinatário (nfDestInt) para match direto
        const docDest = normDoc(nf.nfDestInt?.cnpj_cpf || '');
        const codCliOmie = nf.nfDestInt?.nCodCli ? String(nf.nfDestInt.nCodCli) : '';
        const captureRaw = debug_raw || debug_structure;

        // Iterar itens para separar VENDA vs BONIFICAÇÃO por CFOP
        const itensRaw = nf.itens || nf.det || [];
        const itens = Array.isArray(itensRaw) ? itensRaw : (itensRaw.item || []);
        let valorVenda = 0;
        let valorBonificacao = 0;
        const cfopsEncontrados = {};
        for (const it of itens) {
          const prod = it.prod || it.produto || it;
          const cfopNorm = normCfop(prod.CFOP || prod.cfop);
          if (!cfopNorm) continue;
          cfopsEncontrados[cfopNorm] = (cfopsEncontrados[cfopNorm] || 0) + 1;
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

        nfsValidas.push({
          nIdPedido, cNumero, valorVenda, valorBonificacao,
          cfops: cfopsEncontrados, modelo, tpNF, docDest, codCliOmie,
          _rawIde: captureRaw ? nf.ide : null,
          _rawTipo: captureRaw ? nf.tipo_nota : null,
          _rawDest: captureRaw ? nf.nfDestInt : null,
          _rawCliente: captureRaw ? nf.pedido : null,
          _rawKeys: captureRaw ? Object.keys(nf) : null
        });
      }
      pg++;
    } while (pg <= totalPaginas && pg <= MAX_PAGINAS);

    // 3) Matching: cruzar NFs com espelhos/pedidos/clientes para achar vendedor
    const porVendedor = {};
    const porSupervisor = {};
    let naoIdQtd = 0, naoIdValor = 0;
    let totalVenda = 0;
    let totalBonificacao = 0;
    let totalInstitucional = 0;
    let qtdNfsComVenda = 0;
    const amostraNaoIdSem = [];
    const amostraNaoIdCom = [];
    const amostraRawIde = [];
    let naoIdSemNIdPedido = 0;
    let naoIdComNIdPedido = 0;

    // Coletar NFs que não tiveram match local para fallback ConsultarPedido
    const pendentesFallback = [];

    for (const nf of nfsValidas) {
      totalBonificacao += nf.valorBonificacao;
      if (nf.valorVenda <= 0) continue;
      qtdNfsComVenda++;
      totalVenda += nf.valorVenda;

      // Tentar match no espelho (primário) por nIdPedido ou cNumero
      let vendedorId = '', vendedorNome = '';
      let esp = espelhoByCod.get(nf.nIdPedido) || espelhoByNum.get(nf.cNumero);
      if (esp) {
        vendedorId = esp.vendedor_id || '';
        vendedorNome = esp.vendedor_nome || '';
      } else {
        // Fallback 1: Pedido local por omie_codigo_pedido ou numero_pedido
        const ped = pedidoByCod.get(nf.nIdPedido) || pedidoByNum.get(nf.cNumero);
        if (ped) {
          vendedorId = ped.vendedor_id || '';
          vendedorNome = ped.vendedor_nome || '';
        }
      }

      // Fallback 2: código do cliente Omie (nCodCli do nfDestInt) → Cliente → vendedor_id
      if (!vendedorId && nf.codCliOmie) {
        const cli = clienteByCodOmie.get(nf.codCliOmie);
        if (cli) {
          vendedorId = cli.vendedor_id || '';
          vendedorNome = '';
        }
      }

      // Fallback 3: CNPJ do destinatário → Cliente → vendedor_id
      if (!vendedorId && nf.docDest) {
        const cli = clienteByDoc.get(nf.docDest);
        if (cli) {
          vendedorId = cli.vendedor_id || '';
          vendedorNome = '';
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

      // Se ainda não identificou, coletar para fallback ConsultarPedido
      if (!vendedorId && nf.nIdPedido) {
        if (debug_raw && amostraRawIde.length < 3) {
          amostraRawIde.push({ cNumero: nf.cNumero, nIdPedido: nf.nIdPedido, docDest: nf.docDest, dest: nf._rawDest, cliente: nf._rawCliente, keys: nf._rawKeys });
        }
        pendentesFallback.push(nf);
        continue; // será processado no passo 4
      }

      if (!vendedorNome) {
        naoIdQtd++; naoIdValor += nf.valorVenda;
        const amostraItem = {
          nIdPedido: nf.nIdPedido || '(vazio)', cNumero: nf.cNumero,
          valor: Math.round(nf.valorVenda * 100) / 100, cfops: nf.cfops,
          modelo: nf.modelo || '?', docDest: nf.docDest || '?'
        };
        if (debug_raw && amostraRawIde.length < 3) amostraRawIde.push({ ide: nf._rawIde, tipo_nota: nf._rawTipo, cNumero: nf.cNumero, nIdPedido: nf.nIdPedido, dest: nf._rawDest, cliente: nf._rawCliente, keys: nf._rawKeys });
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

      // Verificar se é venda institucional (APLICATIVO)
      const isInstitucional = vendedorId === ID_APLICATIVO;
      if (isInstitucional) {
        totalInstitucional += nf.valorVenda;
      }

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

    // Debug: retornar estrutura bruta da primeira NF não identificada
    if (debug_structure && pendentesFallback.length > 0) {
      // Buscar a NF original nas nfsValidas (tem os dados brutos)
      const nfRaw = nfsValidas.find(n => n.nIdPedido === pendentesFallback[0].nIdPedido);
      return Response.json({
        nIdPedido: pendentesFallback[0].nIdPedido,
        cNumero: pendentesFallback[0].cNumero,
        docDest: pendentesFallback[0].docDest,
        topKeys: nfRaw?._rawKeys,
        nfDestInt: nfRaw?._rawDest,
        pedido: nfRaw?._rawCliente,
        amostra_count: pendentesFallback.length
      });
    }

    // 4) Fallback Omie: ConsultarPedido para NFs pendentes (sem match local)
    //    ConsultarPedido retorna codigo_cliente → match Cliente.codigo_cliente_omie → vendedor_id
    //    Limita a 8 chamadas para não estourar o timeout da função.
    const MAX_FALLBACK = 8;
    let omieFallbackResolvidos = 0;
    let omieFallbackNaoResolvidos = 0;
    let omieFallbackFalhas = 0;
    let omieFallbackPulados = 0;
    const omieNaoResolvidosDebug = [];

    for (const nf of pendentesFallback) {
      if (omieFallbackResolvidos + omieFallbackNaoResolvidos + omieFallbackFalhas >= MAX_FALLBACK) {
        omieFallbackPulados++;
        naoIdQtd++; naoIdValor += nf.valorVenda;
        naoIdComNIdPedido++;
        if (amostraNaoIdCom.length < 15) {
          amostraNaoIdCom.push({ nIdPedido: nf.nIdPedido, cNumero: nf.cNumero, valor: Math.round(nf.valorVenda * 100) / 100, cfops: nf.cfops, docDest: nf.docDest || '?', motivo: 'limite_fallback' });
        }
        const key = '(vendedor não identificado)||(sem supervisor definido)';
        if (!porVendedor[key]) {
          porVendedor[key] = { vendedor_nome: '(vendedor não identificado)', supervisor_nome: '(sem supervisor definido)', vendedor_id: '', valor: 0, qtd_nfs: 0 };
        }
        porVendedor[key].valor += nf.valorVenda;
        porVendedor[key].qtd_nfs++;
        const supKey = '(sem supervisor definido)';
        if (!porSupervisor[supKey]) {
          porSupervisor[supKey] = { supervisor_nome: supKey, valor: 0, qtd_nfs: 0 };
        }
        porSupervisor[supKey].valor += nf.valorVenda;
        porSupervisor[supKey].qtd_nfs++;
        continue;
      }

      const pedido = await omieConsultarPedido(creds, nf.nIdPedido);
      if (!pedido) { omieFallbackFalhas++; continue; }

      const codCliente = String(pedido.codigo_cliente || pedido.cliente_codigo || '');
      let cli = codCliente ? clienteByCodOmie.get(codCliente) : null;

      // Se não achou por codigo_cliente_omie, tentar por CNPJ se houver
      if (!cli && pedido.cliente?.cnpj_cpf) {
        cli = clienteByDoc.get(normDoc(pedido.cliente.cnpj_cpf));
      }

      if (cli && cli.vendedor_id) {
        omieFallbackResolvidos++;
        const vend = vendedorById.get(cli.vendedor_id);
        const vNome = vend?.nome || cli.vendedor_id;
        let sNome = '';
        if (vend) {
          const supId = vend.supervisor_id || vend.supervisor_ids?.[0];
          if (supId) { const sup = vendedorById.get(supId); if (sup) sNome = sup.nome; }
        }
        const isInstitucional = cli.vendedor_id === ID_APLICATIVO;
        if (isInstitucional) totalInstitucional += nf.valorVenda;

        const key = vNome + '||' + sNome;
        if (!porVendedor[key]) {
          porVendedor[key] = { vendedor_nome: vNome, supervisor_nome: sNome, vendedor_id: cli.vendedor_id, valor: 0, qtd_nfs: 0 };
        }
        porVendedor[key].valor += nf.valorVenda;
        porVendedor[key].qtd_nfs++;
        const supKey = sNome || '(sem supervisor definido)';
        if (!porSupervisor[supKey]) {
          porSupervisor[supKey] = { supervisor_nome: supKey, valor: 0, qtd_nfs: 0 };
        }
        porSupervisor[supKey].valor += nf.valorVenda;
        porSupervisor[supKey].qtd_nfs++;
      } else {
        omieFallbackNaoResolvidos++;
        naoIdQtd++; naoIdValor += nf.valorVenda;
        naoIdComNIdPedido++;
        if (amostraNaoIdCom.length < 15) {
          amostraNaoIdCom.push({ nIdPedido: nf.nIdPedido, cNumero: nf.cNumero, valor: Math.round(nf.valorVenda * 100) / 100, cfops: nf.cfops, codClienteOmie: codCliente || '?', docDest: nf.docDest || '?' });
        }
        if (omieNaoResolvidosDebug.length < 5) {
          omieNaoResolvidosDebug.push({ nIdPedido: nf.nIdPedido, cNumero: nf.cNumero, codClienteOmie: codCliente || '?', docDest: nf.docDest || '?' });
        }
        const key = '(vendedor não identificado)||(sem supervisor definido)';
        if (!porVendedor[key]) {
          porVendedor[key] = { vendedor_nome: '(vendedor não identificado)', supervisor_nome: '(sem supervisor definido)', vendedor_id: '', valor: 0, qtd_nfs: 0 };
        }
        porVendedor[key].valor += nf.valorVenda;
        porVendedor[key].qtd_nfs++;
        const supKey = '(sem supervisor definido)';
        if (!porSupervisor[supKey]) {
          porSupervisor[supKey] = { supervisor_nome: supKey, valor: 0, qtd_nfs: 0 };
        }
        porSupervisor[supKey].valor += nf.valorVenda;
        porSupervisor[supKey].qtd_nfs++;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    const totalComissionavel = totalVenda - totalInstitucional;

    const porVendedorArr = Object.values(porVendedor).map(v => ({ ...v, valor: Math.round(v.valor * 100) / 100 })).sort((a, b) => b.valor - a.valor);
    const porSupervisorArr = Object.values(porSupervisor).map(s => ({ ...s, valor: Math.round(s.valor * 100) / 100 })).sort((a, b) => b.valor - a.valor);

    return Response.json({
      periodo: `${data_inicial} a ${data_final}`,
      fonte: 'OMIE (NF autorizada, CFOP 5.405/6.404 = venda)',
      total_venda_omie: Math.round(totalVenda * 100) / 100,
      total_venda_comissionavel: Math.round(totalComissionavel * 100) / 100,
      total_institucional_aplicativo: Math.round(totalInstitucional * 100) / 100,
      total_bonificacao: Math.round(totalBonificacao * 100) / 100,
      qtd_nfs_venda: qtdNfsComVenda,
      nfs_validas: nfsValidas.length,
      nfs_canceladas: nfsCanceladas,
      nfs_entrada_tpNF0: nfsEntrada,
      nao_identificados: { qtd_nfs: naoIdQtd, valor: Math.round(naoIdValor * 100) / 100 },
      nao_id_sem_nIdPedido: naoIdSemNIdPedido,
      nao_id_com_nIdPedido: naoIdComNIdPedido,
      omie_fallback_resolvidos: omieFallbackResolvidos,
      omie_fallback_nao_resolvidos: omieFallbackNaoResolvidos,
      omie_fallback_falhas: omieFallbackFalhas,
      omie_fallback_pulados: omieFallbackPulados,
      total_paginas_omie: totalPaginas,
      paginas_processadas: pg - 1,
      duracao_ms: Date.now() - t0,
      amostra_nao_id_sem_nIdPedido: amostraNaoIdSem,
      amostra_nao_id_com_nIdPedido: amostraNaoIdCom,
      ...(debug_raw ? { debug_raw_ide: amostraRawIde } : {}),
      ...(resumo ? {} : { por_vendedor: porVendedorArr, por_supervisor: porSupervisorArr })
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});