import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';


function fmt(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function listarNfsRecentes(base44, dias) {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - Number(dias || 30) * 86400000);
  const nfs = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    let data;
    try {
      data = await omieCall(base44, 'produtos/nfconsultar/', {
        pagina, registros_por_pagina: 100, dEmiInicial: fmt(inicio), dEmiFinal: fmt(hoje)
      }, { call: 'ListarNF' });
    } catch (e) {
      if (/n[ãa]o existem registros/i.test(e.message)) break;
      throw e;
    }
    if (data.faultstring) {
      if (/n[ãa]o existem registros/i.test(data.faultstring)) break;
      throw new Error(data.faultstring);
    }
    nfs.push(...(data.nfCadastro || []));
    if (pagina >= (data.nTotPaginas || 1)) break;
    await new Promise(r => setTimeout(r, 1200));
  }
  return nfs;
}

async function getOmieCredentials(base44: any) {
  try {
    const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    if (rows.length > 0) return { appKey: rows[0].app_key, appSecret: rows[0].app_secret };
  } catch (_) { /* ignore */ }
  const appKey = Deno.env.get('OMIE_APP_KEY') || '';
  const appSecret = Deno.env.get('OMIE_APP_SECRET') || '';
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  if (rows.length > 0 && rows[0].bloqueado) {
    const ate = new Date(rows[0].bloqueado_ate || 0);
    if (ate > new Date()) throw new Error(`Circuit breaker ativo até ${ate.toISOString()}`);
  }
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  await checkCircuitBreaker(base44);
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas');
  const call = options.call || endpoint;
  const url = `https://app.omie.com.br/api/v1/${endpoint}`;
  const body = JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Omie ${call} HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const dias = body.dias || 30;
    const limite = body.limite || 500;
    const pedidos = await base44.asServiceRole.entities.Pedido.list('-updated_date', limite);
    const candidatos = pedidos.filter(p => p.omie_codigo_pedido && p.status_faturamento !== 'faturado' && !p.numero_nota_fiscal);
    const nfs = await listarNfsRecentes(base44, dias);
    const nfPorPedido = new Map();

    nfs.forEach(nf => {
      const nIdPedido = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
      const numeroNf = nf.ide?.nNF || nf.cNumero || '';
      const cStat = String(nf.nfStatus?.cStat || nf.compl?.cStat || '').trim();
      if (nIdPedido && numeroNf && (cStat === '100' || cStat === '150' || !cStat)) {
        nfPorPedido.set(nIdPedido, { numero_nf: String(numeroNf), data: nf.ide?.dEmi || new Date().toISOString() });
      }
    });

    let atualizados = 0;
    for (const pedido of candidatos) {
      const nf = nfPorPedido.get(String(pedido.omie_codigo_pedido));
      if (!nf) continue;
      await base44.asServiceRole.entities.Pedido.update(pedido.id, {
        status: 'faturado',
        faturado: true,
        status_faturamento: 'faturado',
        numero_nota_fiscal: nf.numero_nf,
        data_faturamento: nf.data || new Date().toISOString()
      });
      atualizados++;
    }

    return Response.json({ sucesso: true, analisados: candidatos.length, atualizados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});