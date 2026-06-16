import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

async function resolverCreds(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  return {
    app_key: ativo?.app_key || Deno.env.get('OMIE_APP_KEY'),
    app_secret: ativo?.app_secret || Deno.env.get('OMIE_APP_SECRET')
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

/**
 * Sincroniza o Log de Emissão (LogEmissaoNF) com as NFs reais de uma carga no Omie.
 *
 * Caso de uso: NFs emitidas DIRETO no Omie (fora da tela de emissão do app) nunca geram
 * LogEmissaoNF local. Esta função busca as NFs reais da carga no Omie (cruzando pelo
 * nIdPedido — ver LICOES_APRENDIDAS_OMIE.md: ListarNF NÃO filtra por pedido) e cria os
 * logs faltantes como 'autorizada', para que apareçam na aba "Log de Emissão".
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { carga_id, numero_carga } = await req.json().catch(() => ({}));
    if (!carga_id && !numero_carga) {
      return Response.json({ error: 'Informe carga_id ou numero_carga' }, { status: 400 });
    }

    // Carrega a carga
    let carga = null;
    if (carga_id) {
      carga = await base44.asServiceRole.entities.Carga.get(carga_id).catch(() => null);
    }
    if (!carga && numero_carga) {
      const rows = await base44.asServiceRole.entities.Carga.filter({ numero_carga: String(numero_carga) }, '-created_date', 1).catch(() => []);
      carga = rows?.[0] || null;
    }
    if (!carga) return Response.json({ error: 'Carga não encontrada' }, { status: 404 });

    const numCarga = carga.numero_carga;
    const pedidosOmie = carga.pedidos_omie || [];
    if (pedidosOmie.length === 0) {
      return Response.json({ sucesso: true, criados: 0, ja_existentes: 0, mensagem: 'Carga sem pedidos Omie.' });
    }

    // Conjunto-alvo de códigos de pedido (nIdPedido) e índice por pedido para enriquecer o log.
    const alvo = new Set();
    const idxPedido = {};
    pedidosOmie.forEach((p) => {
      const cod = String(p.codigo_pedido || '').replace(/\D/g, '');
      if (cod) { alvo.add(cod); idxPedido[cod] = p; }
    });
    if (alvo.size === 0) {
      return Response.json({ sucesso: true, criados: 0, ja_existentes: 0, mensagem: 'Pedidos sem código Omie.' });
    }

    // Janela de datas em torno da data da carga (cobre NF emitida na véspera).
    const fmt = (d) => {
      const dia = String(d.getDate()).padStart(2, '0');
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      return `${dia}/${mes}/${d.getFullYear()}`;
    };
    const dataBase = carga.data_faturamento || carga.data_carga;
    let dEmiInicial, dEmiFinal;
    const dBase = dataBase ? new Date(dataBase) : null;
    if (dBase && !isNaN(dBase.getTime())) {
      dEmiInicial = fmt(new Date(dBase.getTime() - 3 * 24 * 60 * 60 * 1000));
      dEmiFinal = fmt(new Date(dBase.getTime() + 1 * 24 * 60 * 60 * 1000));
    } else {
      const hoje = new Date();
      dEmiInicial = fmt(new Date(hoje.getTime() - 15 * 24 * 60 * 60 * 1000));
      dEmiFinal = fmt(hoje);
    }

    // Varre as NFs do período e cruza pelo nIdPedido.
    const nfsPorPedido = {};
    let pg = 1, totalPaginas = 1;
    const MAX_PAGINAS = 30;
    do {
      const d = await omieCall(base44, 'ListarNF', { pagina: pg, registros_por_pagina: 100, dEmiInicial, dEmiFinal });
      totalPaginas = d.nTotPaginas || d.total_de_paginas || 1;
      (d.nfCadastro || []).forEach((nf) => {
        const idPed = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
        if (idPed && alvo.has(idPed)) {
          nfsPorPedido[idPed] = {
            numero_nf: String(nf.ide?.nNF || '').replace(/^0+/, '') || String(nf.ide?.nNF || ''),
            numero_nf_raw: nf.ide?.nNF,
            chave: nf.compl?.cChaveNFe || '',
            cStat: String(nf.nfStatus?.cStat || nf.compl?.cStat || ''),
            cancelada: !!(nf.ide?.dCan && String(nf.ide.dCan).trim())
          };
        }
      });
      if (Object.keys(nfsPorPedido).length >= alvo.size) break;
      pg++;
    } while (pg <= totalPaginas && pg <= MAX_PAGINAS);

    // Logs já existentes desta carga (evita duplicar).
    const logsExistentes = await base44.asServiceRole.entities.LogEmissaoNF.filter(
      { numero_carga: String(numCarga) }, '-created_date', 500
    ).catch(() => []);
    const pedidosComLog = new Set(logsExistentes.map(l => String(l.codigo_pedido || '').replace(/\D/g, '')));

    // Cria logs faltantes para os pedidos que TÊM NF no Omie mas NÃO têm log local.
    const novos = [];
    for (const idPed of Object.keys(nfsPorPedido)) {
      if (pedidosComLog.has(idPed)) continue;
      const info = nfsPorPedido[idPed];
      const p = idxPedido[idPed] || {};
      novos.push({
        codigo_pedido: idPed,
        numero_pedido: p.numero_pedido || '',
        numero_nf: info.numero_nf_raw || info.numero_nf || '',
        cliente_id: p.cliente_id || '',
        cliente_nome: p.nome_cliente || p.nome_fantasia || '',
        carga_id: carga.id,
        numero_carga: String(numCarga),
        status: info.cancelada ? 'rejeitada' : 'autorizada',
        codigo_sefaz: info.cancelada ? '101' : '100',
        mensagem: info.cancelada
          ? 'NF cancelada no Omie'
          : 'NF emitida diretamente no Omie (sincronizada pelo log da carga)',
        usuario_email: user.email,
        usuario_nome: user.full_name || ''
      });
    }

    let criados = 0;
    if (novos.length > 0) {
      await base44.asServiceRole.entities.LogEmissaoNF.bulkCreate(novos);
      criados = novos.length;
    }

    return Response.json({
      sucesso: true,
      criados,
      ja_existentes: pedidosComLog.size,
      nfs_encontradas_omie: Object.keys(nfsPorPedido).length,
      total_pedidos_carga: alvo.size,
      numero_carga: numCarga
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});