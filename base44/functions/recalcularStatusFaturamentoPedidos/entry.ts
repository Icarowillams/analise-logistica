import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

function fmt(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function listarNfsRecentes(dias) {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - Number(dias || 30) * 86400000);
  const nfs = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const res = await fetch(OMIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarNF',
        app_key: APP_KEY,
        app_secret: APP_SECRET,
        param: [{ pagina, registros_por_pagina: 100, dEmiInicial: fmt(inicio), dEmiFinal: fmt(hoje) }]
      })
    });
    const data = await res.json();
    if (data.faultstring) {
      if (/n[ãa]o existem registros/i.test(data.faultstring)) break;
      throw new Error(data.faultstring);
    }
    nfs.push(...(data.nfCadastro || []));
    if (pagina >= (data.nTotPaginas || 1)) break;
  }
  return nfs;
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
    const nfs = await listarNfsRecentes(dias);
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