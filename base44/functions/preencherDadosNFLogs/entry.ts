import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function resolverCreds(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  return {
    app_key: ativo?.app_key || Deno.env.get('OMIE_APP_KEY'),
    app_secret: ativo?.app_secret || Deno.env.get('OMIE_APP_SECRET')
  };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate };
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
      if (res.status === 425) { const e = new Error(lastErr); e.code = 'OMIE_425'; throw e; }
      if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
    const data = await res.json();
    if (data.faultstring) throw new Error(data.faultstring);
    return data;
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}

const fmtData = (d) => {
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
};

/**
 * Preenche número da NF / cStat / chave nos logs já marcados como "autorizada" mas que
 * ficaram SEM número de NF (foram marcados apenas por etapa 60, sem buscar a NF real —
 * ConsultarPedido não traz o nNF).
 *
 * Estratégia eficiente: varre ListarNF (produtos/nfconsultar/) por janela de datas e cruza
 * pelo nIdPedido (= codigo_pedido do log). Atualiza os logs existentes com numero_nf, cStat
 * e chave reais. Cobre TODAS as cargas de uma vez, sem consultar pedido a pedido.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Apenas administradores' }, { status: 403 });
    }

    // ── PASSO LOCAL (sem Omie): preenche numero_pedido / cliente / carga nos logs que ficaram crus. ──
    // Casa o log pelo omie_codigo_pedido no Pedido local e grava os campos que faltam. Roda na hora,
    // independente do circuit breaker, e cobre logs de QUALQUER status (autorizada, rejeitada, erro).
    let dadosLocaisPreenchidos = 0;
    const logsRecentes = await base44.asServiceRole.entities.LogEmissaoNF.list('-created_date', 500).catch(() => []);
    const crus = logsRecentes.filter(l => l.codigo_pedido && (!l.cliente_id || !l.numero_pedido || !l.cliente_nome || !l.numero_carga));
    for (const log of crus) {
      const peds = await base44.asServiceRole.entities.Pedido.filter(
        { omie_codigo_pedido: String(log.codigo_pedido) }, '-created_date', 1
      ).catch(() => []);
      const ped = peds[0];
      if (!ped) continue;
      const upd = {};
      if (!log.numero_pedido && ped.numero_pedido) upd.numero_pedido = ped.numero_pedido;
      if (!log.cliente_id && ped.cliente_id) upd.cliente_id = ped.cliente_id;
      if (!log.cliente_nome && (ped.cliente_nome || ped.cliente_nome_fantasia)) upd.cliente_nome = ped.cliente_nome || ped.cliente_nome_fantasia;
      if (!log.numero_carga && ped.numero_carga) upd.numero_carga = ped.numero_carga;
      if (Object.keys(upd).length > 0) {
        await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, upd).catch(() => {});
        dadosLocaisPreenchidos++;
      }
    }

    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) {
      return Response.json({ sucesso: true, motivo: 'circuit_breaker_ativo', bloqueado_ate: cb.blockedUntil, preenchidos: 0, dados_locais_preenchidos: dadosLocaisPreenchidos });
    }

    const body = await req.json().catch(() => ({}));
    const diasJanela = Math.min(Math.max(body.dias || 15, 1), 60);

    // Logs autorizados SEM número de NF, com código Omie para casar.
    const autorizados = await base44.asServiceRole.entities.LogEmissaoNF.filter(
      { status: 'autorizada' }, '-created_date', 500
    ).catch(() => []);
    const pendentes = autorizados
      .filter(l => (!l.numero_nf || String(l.numero_nf).trim() === '') && l.codigo_pedido);

    if (pendentes.length === 0) {
      return Response.json({ sucesso: true, mensagem: 'Nenhum log autorizado sem número de NF', preenchidos: 0, dados_locais_preenchidos: dadosLocaisPreenchidos });
    }

    // Índice dos logs pendentes por nIdPedido (codigo_pedido sem não-dígitos).
    const logPorPedido = {};
    const alvo = new Set();
    pendentes.forEach(l => {
      const cod = String(l.codigo_pedido || '').replace(/\D/g, '');
      if (cod) { logPorPedido[cod] = l; alvo.add(cod); }
    });

    // Janela de datas baseada na data de criação mais antiga dos logs pendentes.
    const datas = pendentes.map(l => l.created_date ? new Date(l.created_date).getTime() : Date.now()).filter(Boolean);
    const maisAntigo = datas.length ? Math.min(...datas) : Date.now();
    const dEmiInicial = fmtData(new Date(maisAntigo - 2 * 24 * 60 * 60 * 1000));
    const dEmiFinal = fmtData(new Date(Date.now() + 1 * 24 * 60 * 60 * 1000));

    // Varre as NFs do período e cruza pelo nIdPedido.
    const nfsPorPedido = {};
    let pg = 1, totalPaginas = 1;
    const MAX_PAGINAS = 40;
    let bloqueado = false;
    try {
      do {
        const d = await omieListarNF(base44, { pagina: pg, registros_por_pagina: 100, dEmiInicial, dEmiFinal });
        totalPaginas = d.nTotPaginas || d.total_de_paginas || 1;
        (d.nfCadastro || []).forEach((nf) => {
          const idPed = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
          if (idPed && alvo.has(idPed) && !nfsPorPedido[idPed]) {
            nfsPorPedido[idPed] = {
              numero_nf: String(nf.ide?.nNF || ''),
              chave: nf.compl?.cChaveNFe || '',
              cStat: String(nf.nfStatus?.cStat || nf.compl?.cStat || ''),
              cancelada: !!(nf.ide?.dCan && String(nf.ide.dCan).trim())
            };
          }
        });
        if (Object.keys(nfsPorPedido).length >= alvo.size) break;
        pg++;
        await new Promise(r => setTimeout(r, 400)); // respeita rate limit entre páginas
      } while (pg <= totalPaginas && pg <= MAX_PAGINAS);
    } catch (e) {
      if (e.code === 'OMIE_425') bloqueado = true;
      else throw e;
    }

    // Atualiza os logs encontrados.
    let preenchidos = 0;
    const resultados = [];
    for (const idPed of Object.keys(nfsPorPedido)) {
      const info = nfsPorPedido[idPed];
      const log = logPorPedido[idPed];
      if (!log || !info.numero_nf) continue;
      const upd = {
        numero_nf: info.numero_nf,
        codigo_sefaz: info.cStat || (info.cancelada ? '101' : '100'),
        status: info.cancelada ? 'rejeitada' : 'autorizada',
        mensagem: info.cancelada ? 'NF cancelada no Omie' : `NF ${info.numero_nf} autorizada`
      };
      if (info.chave) upd.chave_nfe = info.chave;
      await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, upd).catch(() => {});
      preenchidos++;
      resultados.push({ pedido: log.numero_pedido, numero_nf: info.numero_nf });
    }

    return Response.json({
      sucesso: true,
      total_pendentes: pendentes.length,
      nfs_encontradas: Object.keys(nfsPorPedido).length,
      preenchidos,
      dados_locais_preenchidos: dadosLocaisPreenchidos,
      circuit_breaker: bloqueado,
      resultados
    });
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada }, { status: bloqueada ? 425 : 500 });
  }
});