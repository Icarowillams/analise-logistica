// Diagnóstico: para uma carga, lista os títulos no Omie e verifica boleto por título (ObterBoleto)
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_CR = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const OMIE_BOLETO = 'https://app.omie.com.br/api/v1/financas/contareceberboleto/';

async function getCreds(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return {
    app_key: Deno.env.get('OMIE_APP_KEY') || cfg?.app_key || '',
    app_secret: Deno.env.get('OMIE_APP_SECRET') || cfg?.app_secret || ''
  };
}

async function omieCall(creds, url, call, param) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: creds.app_key, app_secret: creds.app_secret, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) throw new Error(data.faultstring);
  return data;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const soNum = (v) => String(v || '').replace(/\D/g, '');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { numero_carga } = await req.json().catch(() => ({}));
    const cargas = await base44.asServiceRole.entities.Carga.filter({ numero_carga: String(numero_carga) }, '-created_date', 1);
    const carga = cargas?.[0];
    if (!carga) return Response.json({ error: 'Carga não encontrada' }, { status: 404 });

    const pedidos = carga.pedidos_omie || [];
    const nfs = new Map(); // nf normalizada -> pedido
    pedidos.forEach(p => { const nf = soNum(p.numero_nf); if (nf) nfs.set(nf, p); });

    const creds = await getCreds(base44);

    // Busca títulos por emissão na data da carga (±7 dias)
    const [y, m, d] = String(carga.data_carga).split('-');
    const dataCarga = new Date(Number(y), Number(m) - 1, Number(d));
    const fmt = (dt) => `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    const de = fmt(new Date(dataCarga.getTime() - 7 * 86400000));
    const ate = fmt(new Date(dataCarga.getTime() + 7 * 86400000));

    let titulos = [];
    for (let pag = 1; pag <= 10; pag++) {
      const data = await omieCall(creds, OMIE_CR, 'ListarContasReceber', {
        pagina: pag, registros_por_pagina: 100, apenas_importado_api: 'N',
        filtrar_por_emissao_de: de, filtrar_por_emissao_ate: ate
      });
      titulos.push(...(data.conta_receber_cadastro || []));
      if (pag >= (data.total_de_paginas || 1)) break;
      await sleep(500);
    }

    // Match por nº do pedido (títulos Omie carregam numero_pedido) ou por NF
    const pedidosPorNum = new Map();
    pedidos.forEach(p => {
      const n = String(Number(soNum(p.numero_pedido)) || '').trim();
      if (n) pedidosPorNum.set(n, p);
    });
    const doCarga = titulos.filter(t => {
      const nPed = String(Number(soNum(t.numero_pedido)) || '').trim();
      return (nPed && pedidosPorNum.has(nPed)) || nfs.has(soNum(t.numero_documento));
    });

    const amostraRaw = titulos.slice(0, 15).map(t => ({
      cod: t.codigo_lancamento_omie,
      doc: t.numero_documento || null,
      emissao: t.data_emissao,
      cnpj: t.cpf_cnpj_cliente,
      valor: t.valor_documento,
      nPedido: t.numero_pedido || t.nCodPedido || null
    }));

    const resultado = [];
    for (let i = 0; i < doCarga.length; i++) {
      const t = doCarga[i];
      const ped = pedidosPorNum.get(String(Number(soNum(t.numero_pedido)) || '').trim());
      const item = {
        p: t.numero_pedido,
        cli: (ped?.nome_fantasia || ped?.nome_cliente || '').slice(0, 25),
        cod: t.codigo_lancamento_omie,
        st: t.status_titulo,
        flag_boleto_gerado: t.boleto?.cGerado === 'S',
        flag_numero_boleto: t.boleto?.cNumBoleto || ''
      };
      if (item.flag_boleto_gerado || item.flag_numero_boleto) {
        item.obter_boleto = 'TEM BOLETO (flag Omie)';
      } else {
        try {
          const ob = await omieCall(creds, OMIE_BOLETO, 'ObterBoleto', { nCodTitulo: Number(t.codigo_lancamento_omie) });
          item.obter_boleto = ob?.cLinkBoleto ? 'OK (link)' : `SEM LINK: ${ob?.cDesStatus || '?'}`;
        } catch (e) {
          item.obter_boleto = `ERRO: ${e.message}`;
        }
        await sleep(2000);
      }
      resultado.push(item);
    }

    // Pedidos da carga sem nenhum título encontrado
    const pedidosEncontrados = new Set(doCarga.map(t => String(Number(soNum(t.numero_pedido)) || '').trim()));
    const nfsSemTitulo = [...pedidosPorNum.entries()]
      .filter(([n]) => !pedidosEncontrados.has(n))
      .map(([n, p]) => ({ numero_pedido: n, nf: p.numero_nf, cliente: p.nome_fantasia || p.nome_cliente }));

    const comBoleto = resultado.filter(r => r.obter_boleto.startsWith('TEM') || r.obter_boleto.startsWith('OK'));
    const semBoleto = resultado.filter(r => !comBoleto.includes(r));
    return Response.json({
      sucesso: true,
      carga: carga.numero_carga,
      total_pedidos_omie: pedidos.length,
      titulos_encontrados: doCarga.length,
      com_boleto: comBoleto.map(r => `${r.p} ${r.cli}`),
      sem_boleto: semBoleto.map(r => `${r.p} ${r.cli} -> ${r.obter_boleto}`),
      pedidos_sem_titulo: nfsSemTitulo
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});