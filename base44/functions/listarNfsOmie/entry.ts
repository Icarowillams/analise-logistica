import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

async function resolverCreds(base44) {
  // ENV PRIMEIRO (fonte de verdade). Banco só como fallback.
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { app_key: envKey, app_secret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  return {
    app_key: envKey || ativo?.app_key,
    app_secret: envSecret || ativo?.app_secret
  };
}

async function omieCall(base44, call, param) {
  const { app_key, app_secret } = await resolverCreds(base44);
  if (!app_key || !app_secret) throw new Error('Credenciais Omie não configuradas.');

  const url = OMIE_BASE_URL + 'produtos/nfconsultar/';
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call, app_key, app_secret, param: [param] })
    });
    // Status HTTP ANTES de res.json() — num 5xx/429/425 o corpo não costuma ser JSON.
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
    // (erros estruturais 5001/"não faz parte da estrutura" vêm como faultstring e são
    // lançados imediatamente, sem retry — o loop de RETRIES só roda em 5xx/429/425 HTTP.)
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      data_inicial,
      data_final,
      pagina = 1,
      registros_por_pagina = 50,
      nome_cliente,
      cnpj_cliente,
      numeros_nf,
      codigos_pedido,
      incluir_raw = false,
      apenas_autorizadas = false
    } = body;

    const derivarStatus = (nf) => {
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
    };

    const mapNf = (nf) => ({
      nIdNF: nf.compl?.nIdNF || nf.nIdNF || nf.nCodNF,
      nCodNF: nf.compl?.nIdNF || nf.nIdNF || nf.nCodNF,
      nIdPedido: nf.compl?.nIdPedido || nf.nIdPedido,
      cNumero: nf.ide?.nNF || nf.cNumero,
      cSerie: nf.ide?.serie || nf.cSerie,
      cChaveNFe: nf.compl?.cChaveNFe || nf.cChaveNFe,
      dEmiNF: nf.ide?.dEmi || nf.dEmiNF,
      hEmiNF: nf.ide?.hEmi || nf.hEmiNF,
      dCanNF: nf.ide?.dCan || null,
      dInutNF: nf.ide?.dInut || null,
      cDeneg: nf.ide?.cDeneg || null,
      cRazao: nf.nfDestInt?.cRazao || nf.cRazao,
      cNomeFantasia: nf.nfDestInt?.cNomeFantasia || nf.nfDestInt?.nome_fantasia || '',
      cCPFCNPJDest: nf.nfDestInt?.cnpj_cpf || nf.cCPFCNPJDest,
      nValorNF: nf.total?.ICMSTot?.vNF || nf.nValorNF,
      cStatus: derivarStatus(nf),
      cOperacao: nf.ide?.cNatOp || nf.cOperacao,
      // Payload ENXUTO na listagem: só a contagem de itens. Os itens (nf.det), o total
      // detalhado e o objeto cru (nf_raw) são pesados — multiplicados por 50-100 NFs
      // estouravam a serialização da resposta (erro 500). O detalhe de UMA nota é
      // carregado sob demanda via consultarDetalheNotaOmie ao abrir/imprimir.
      qtd_itens: (nf.det || []).length,
      // Só inclui dados completos quando o front pedir explicitamente (incluir_raw=true).
      ...(incluir_raw ? { itens: nf.det || [], total: nf.total || null, nf_raw: nf } : {})
    });

    // ─────────────────────────────────────────────────────────────────────────
    // CAMINHO RÁPIDO: lista explícita de números de NF (busca por CARGA).
    // ATENÇÃO: a API ListarNF do Omie NÃO aceita o campo nNF como filtro
    // (Tag [NNF] não faz parte da estrutura → erro 5001). O único filtro válido é
    // por FAIXA DE DATAS (dEmiInicial/dEmiFinal) + CNPJ/Razão. Então varremos as NFs
    // do período (janela passada pela tela, em torno da data da carga) e cruzamos
    // localmente pelo número da nota (ide.nNF). Sem disparar a chamada que falha 100%.
    // ─────────────────────────────────────────────────────────────────────────
    if (Array.isArray(numeros_nf) && numeros_nf.length > 0) {
      const alvo = new Set(
        numeros_nf.map(n => Number(String(n).replace(/\D/g, ''))).filter(n => n > 0).map(String)
      );
      if (alvo.size === 0) {
        return Response.json({ sucesso: true, nfs: [], pagina: 1, total_de_paginas: 1, total_de_registros: 0 });
      }

      const fmt = (d) => {
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        return `${dia}/${mes}/${d.getFullYear()}`;
      };
      const hoje = new Date();
      const inicioPadrao = new Date(hoje.getTime() - 15 * 24 * 60 * 60 * 1000);
      const dEmiInicial = data_inicial || fmt(inicioPadrao);
      const dEmiFinal = data_final || fmt(hoje);

      const t0 = Date.now();
      const encontradas = [];
      let pg = 1;
      let totalPaginas = 1;
      const MAX_PAGINAS = 30;
      do {
        const d = await omieCall(base44, 'ListarNF', {
          pagina: pg,
          registros_por_pagina: 100,
          dEmiInicial,
          dEmiFinal
        });
        totalPaginas = d.nTotPaginas || d.total_de_paginas || 1;
        (d.nfCadastro || []).forEach((nf) => {
          const num = String(nf.ide?.nNF || nf.cNumero || '').replace(/\D/g, '');
          if (num && alvo.has(num)) encontradas.push(mapNf(nf));
        });
        if (encontradas.length >= alvo.size) break;
        pg++;
      } while (pg <= totalPaginas && pg <= MAX_PAGINAS);

      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'produtos/nfconsultar',
        call: 'ListarNF',
        operacao: 'listar_nfs_por_numeros',
        status: 'sucesso',
        duracao_ms: Date.now() - t0,
        usuario_email: user.email
      }).catch(() => {});

      return Response.json({
        sucesso: true,
        nfs: encontradas,
        pagina: 1,
        total_de_paginas: 1,
        total_de_registros: encontradas.length
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CAMINHO 2: lista de códigos de pedido (busca por CARGA).
    // IMPORTANTE: o ListarNF do Omie NÃO aceita filtrar por pedido (nIdPedido /
    // nIdPedidoVenda / nCodPedido são rejeitados pela API). PORÉM cada NF retornada
    // traz o nIdPedido dentro de compl.nIdPedido — então a estratégia confiável é:
    // buscar as NFs por FAIXA DE DATAS (a data da carga / período passado pela tela,
    // ou uma janela padrão recente), varrer as páginas e CRUZAR pelo nIdPedido.
    // ─────────────────────────────────────────────────────────────────────────
    if (Array.isArray(codigos_pedido) && codigos_pedido.length > 0) {
      const alvo = new Set(
        codigos_pedido.map(c => String(c).replace(/\D/g, '')).filter(Boolean)
      );
      if (alvo.size === 0) {
        return Response.json({ sucesso: true, nfs: [], pagina: 1, total_de_paginas: 1, total_de_registros: 0 });
      }

      // Faixa de datas: usa data_inicial/data_final se a tela enviar (data da carga);
      // senão, janela padrão dos últimos 15 dias até hoje (cobre NF emitida na véspera).
      const fmt = (d) => {
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        return `${dia}/${mes}/${d.getFullYear()}`;
      };
      const hoje = new Date();
      const inicioPadrao = new Date(hoje.getTime() - 15 * 24 * 60 * 60 * 1000);
      const dEmiInicial = data_inicial || fmt(inicioPadrao);
      const dEmiFinal = data_final || fmt(hoje);

      const t0 = Date.now();
      const encontradas = [];
      let pg = 1;
      let totalPaginas = 1;
      const MAX_PAGINAS = 30; // teto de segurança
      do {
        const d = await omieCall(base44, 'ListarNF', {
          pagina: pg,
          registros_por_pagina: 100,
          dEmiInicial,
          dEmiFinal
        });
        totalPaginas = d.nTotPaginas || d.total_de_paginas || 1;
        (d.nfCadastro || []).forEach((nf) => {
          const idPed = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
          if (idPed && alvo.has(idPed)) encontradas.push(mapNf(nf));
        });
        // Para cedo se já achou todas as NFs dos pedidos solicitados.
        if (encontradas.length >= alvo.size) break;
        pg++;
      } while (pg <= totalPaginas && pg <= MAX_PAGINAS);

      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'produtos/nfconsultar',
        call: 'ListarNF',
        operacao: 'listar_nfs_por_pedidos',
        status: 'sucesso',
        duracao_ms: Date.now() - t0,
        usuario_email: user.email
      }).catch(() => {});

      return Response.json({
        sucesso: true,
        nfs: encontradas,
        pagina: 1,
        total_de_paginas: 1,
        total_de_registros: encontradas.length
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CAMINHO PADRÃO: busca por data / nome / CNPJ — PAGINADO no servidor.
    // Busca SÓ a página solicitada do Omie (100 por página). Antes varria TODAS as
    // páginas do período (ex: 2300+ NFs = ~24 chamadas sequenciais), o que deixava a
    // consulta lentíssima. Agora 1 página = 1 chamada. A navegação entre páginas
    // refaz a busca apenas da página pedida.
    // ─────────────────────────────────────────────────────────────────────────
    const paramBase = {
      registros_por_pagina: Math.min(Number(registros_por_pagina) || 50, 100),
      // Pede ao Omie a ordem DECRESCENTE por número da NF (que cresce com o tempo) →
      // página 1 já vem com as NFs mais RECENTES. Sem isso, a pág. 1 trazia as mais antigas.
      ordenar_por: 'NUMERO',
      ordem_decrescente: 'S'
    };
    if (data_inicial) paramBase.dEmiInicial = data_inicial;
    if (data_final) paramBase.dEmiFinal = data_final;
    if (nome_cliente) paramBase.cRazao = nome_cliente;
    if (cnpj_cliente) paramBase.cCPFCNPJDest = cnpj_cliente.replace(/\D/g, '');

    const t0 = Date.now();
    const d = await omieCall(base44, 'ListarNF', { ...paramBase, pagina: Number(pagina) || 1 });
    const totalPaginas = d.nTotPaginas || d.total_de_paginas || 1;
    const totalRegistros = d.nTotRegistros || d.total_de_registros || (d.nfCadastro || []).length;

    const nfsPagina = [];
    (d.nfCadastro || []).forEach((nf) => {
      const mapped = mapNf(nf);
      if (apenas_autorizadas && mapped.cStatus !== 'autorizada') return;
      nfsPagina.push(mapped);
    });

    // Garantia local: ordena a página por nº da NF DESC (mais recentes primeiro),
    // caso o Omie ignore o ordenar_por.
    nfsPagina.sort((a, b) =>
      Number(String(b.cNumero || '').replace(/\D/g, '')) - Number(String(a.cNumero || '').replace(/\D/g, ''))
    );

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/nfconsultar',
      call: 'ListarNF',
      operacao: 'listar_nfs',
      status: 'sucesso',
      duracao_ms: Date.now() - t0,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      nfs: nfsPagina,
      pagina: Number(pagina) || 1,
      total_de_paginas: totalPaginas,
      total_de_registros: totalRegistros
    });
  } catch (error) {
    // Loga o erro real no LogIntegracaoOmie (antes só sucessos eram registrados) para rastrear.
    try {
      const base44b = createClientFromRequest(req);
      const u = await base44b.auth.me().catch(() => null);
      await base44b.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'produtos/nfconsultar',
        call: 'ListarNF',
        operacao: 'listar_nfs',
        status: 'erro',
        mensagem_erro: String(error.message || error).slice(0, 500),
        usuario_email: u?.email || ''
      }).catch(() => {});
    } catch { /* ignore log failure */ }
    return Response.json({ error: error.message }, { status: 500 });
  }
});