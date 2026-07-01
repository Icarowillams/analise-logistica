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
    const { data_inicial, data_final, max_paginas = 50 } = body;

    if (!data_inicial || !data_final) {
      return Response.json({ error: 'data_inicial e data_final são obrigatórios (formato DD/MM/AAAA)' }, { status: 400 });
    }

    const t0 = Date.now();

    // Acumuladores
    const cfopMap = new Map();   // cfop -> { qtd_nfs, valor_total, exemplo_nf, exemplo_cliente, exemplo_produto }
    const serieMap = new Map();  // serie -> { qtd_nfs, valor_total, tpNF }
    let nfsSaida = 0;
    let nfsEntrada = 0;
    let nfsCanceladas = 0;
    let nfsOutroStatus = 0;
    let totalPaginas = 1;
    let pg = 1;

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
        if (cStat === '101' || dCan) { nfsCanceladas++; continue; }
        if (cStat && cStat !== '100' && cStat !== '135') { nfsOutroStatus++; continue; }

        const tpNF = String(nf.ide?.tpNF || '');
        const serie = String(nf.ide?.serie || nf.ide?.cSerie || nf.cSerie || '');
        const valor = nf.total?.ICMSTot?.vNF || nf.nValorNF || 0;
        const clienteNome = nf.dest?.xNome || nf.cliente?.cNomeRazSocial || nf.destinatario?.xNome || '';

        // Contagem por série (todas as autorizadas, entrada e saída)
        if (!serieMap.has(serie)) serieMap.set(serie, { serie, qtd_nfs: 0, valor_total: 0, tpNFs: {} });
        const s = serieMap.get(serie);
        s.qtd_nfs++;
        s.valor_total += valor;
        s.tpNFs[tpNF] = (s.tpNFs[tpNF] || 0) + 1;

        // Só processa CFOP para Saída (tpNF=1)
        if (tpNF === '0') { nfsEntrada++; continue; }
        nfsSaida++;

        // Extrai CFOP dos itens. Omie retorna nf.itens[].item.prod.CFOP ou nf.itens[].prod.CFOP
        const itensRaw = nf.itens || nf.det || [];
        const itens = Array.isArray(itensRaw) ? itensRaw : (itensRaw.item || []);

        // Conta CFOPs por item para pegar o predominante
        const cfopCount = new Map();
        let primeiroCfop = '';
        let primeiroProduto = '';
        for (const it of itens) {
          const prod = it.prod || it.produto || it;
          const cfop = String(prod.CFOP || prod.cfop || '').trim();
          if (!cfop) continue;
          cfopCount.set(cfop, (cfopCount.get(cfop) || 0) + 1);
          if (!primeiroCfop) {
            primeiroCfop = cfop;
            primeiroProduto = String(prod.xProd || prod.cProduto || prod.descricao || '');
          }
        }

        // CFOP predominante da nota (mais frequente nos itens)
        let cfopPredominante = primeiroCfop;
        let maxCount = 0;
        for (const [cf, cnt] of cfopCount) {
          if (cnt > maxCount) { maxCount = cnt; cfopPredominante = cf; }
        }

        if (!cfopPredominante) cfopPredominante = '(sem CFOP)';

        if (!cfopMap.has(cfopPredominante)) {
          cfopMap.set(cfopPredominante, {
            cfop: cfopPredominante,
            qtd_nfs: 0,
            valor_total: 0,
            exemplo_nf: String(nf.ide?.nNF || nf.cNumero || ''),
            exemplo_cliente: clienteNome,
            exemplo_produto: primeiroProduto
          });
        }
        const c = cfopMap.get(cfopPredominante);
        c.qtd_nfs++;
        c.valor_total += valor;
      }
      pg++;
    } while (pg <= totalPaginas && pg <= max_paginas);

    const cfopsArr = Array.from(cfopMap.values())
      .map(c => ({ ...c, valor_total: Math.round(c.valor_total * 100) / 100 }))
      .sort((a, b) => b.valor_total - a.valor_total);

    const seriesArr = Array.from(serieMap.values())
      .map(s => ({ ...s, valor_total: Math.round(s.valor_total * 100) / 100 }))
      .sort((a, b) => b.qtd_nfs - a.qtd_nfs);

    return Response.json({
      periodo: `${data_inicial} a ${data_final}`,
      nfs_saida: nfsSaida,
      nfs_entrada: nfsEntrada,
      nfs_canceladas: nfsCanceladas,
      nfs_outro_status: nfsOutroStatus,
      total_paginas: totalPaginas,
      paginas_processadas: pg - 1,
      duracao_ms: Date.now() - t0,
      cfops: cfopsArr,
      series: seriesArr
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});