import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
const NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const DFE_URL = 'https://app.omie.com.br/api/v1/produtos/dfedocs/';
const PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

async function omieCall(url, call, param, tentativa = 1) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });

  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring || '').toLowerCase();
    const code = String(data.faultcode || '');
    const retry = res.status === 429 || code.includes('425') || code.includes('520') || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('indispon');
    if (retry && tentativa < 4) {
      await new Promise(r => setTimeout(r, 2500 * tentativa));
      return omieCall(url, call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

function pickId(detalhe, body) {
  return body.nIdNF || body.nIdNfe || detalhe?.compl?.nIdNF || detalhe?.nIdNF || detalhe?.nCodNF || null;
}

function nfChaveFromBody(body) {
  const chave = {};
  if (body.nIdNF) chave.nCodNF = Number(body.nIdNF);
  if (body.nCodNF) chave.nCodNF = Number(body.nCodNF);
  if (body.nNF) chave.nNF = String(body.nNF);
  if (body.cNumero) chave.nNF = String(body.cNumero);
  return chave;
}

function downloadDataUrl(content, mime) {
  if (!content) return null;
  if (/^https?:\/\//i.test(String(content))) return content;
  return `data:${mime};charset=utf-8,${encodeURIComponent(String(content))}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const chaveNF = nfChaveFromBody(body);
    if (!chaveNF.nCodNF && !chaveNF.nNF && !body.nIdPedido && !body.codigo_pedido) {
      return Response.json({ error: 'Informe nIdNF/nCodNF, número da NF ou pedido' }, { status: 400 });
    }

    const t0 = Date.now();
    let detalhe = null;
    let detalheErro = null;

    try {
      detalhe = await omieCall(NF_URL, 'ConsultarNF', chaveNF);
    } catch (e) {
      detalheErro = e.message;
    }

    const nIdNfe = pickId(detalhe, body);
    const nIdPedido = body.nIdPedido || detalhe?.compl?.nIdPedido || detalhe?.nIdPedido || null;

    const chamadas = [];
    if (nIdNfe) {
      chamadas.push(['nfe_completa', omieCall(DFE_URL, 'ObterNfe', { nIdNfe: Number(nIdNfe) })]);
      chamadas.push(['danfe_simplificado', omieCall(DFE_URL, 'ObterDanfeSimp', { nIdNfe: Number(nIdNfe) })]);
    }
    if (nIdPedido) {
      chamadas.push(['pedido_pdf', omieCall(DFE_URL, 'ObterPedVenda', { nIdPed: Number(nIdPedido) })]);
      chamadas.push(['pedido_completo', omieCall(PEDIDO_URL, 'ConsultarPedido', { codigo_pedido: Number(nIdPedido) })]);
    }

    const resultados = await Promise.allSettled(chamadas.map(([, promise]) => promise));
    const extras = {};
    const erros = { detalhe: detalheErro };

    chamadas.forEach(([nome], index) => {
      const r = resultados[index];
      if (r.status === 'fulfilled') extras[nome] = r.value;
      else erros[nome] = r.reason?.message || 'Falha na consulta';
    });

    const nfe = extras.nfe_completa || {};
    const danfeSimp = extras.danfe_simplificado || {};
    const pedidoPdf = extras.pedido_pdf || {};

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/nfconsultar + produtos/dfedocs + produtos/pedido',
      call: 'ConsultarNF + ObterNfe + ObterDanfeSimp + ObterPedVenda + ConsultarPedido',
      operacao: 'extrair_nfe_completa',
      status: 'sucesso',
      duracao_ms: Date.now() - t0,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      ids: { nIdNfe, nIdPedido },
      resumo: {
        numero: detalhe?.ide?.nNF || nfe.cNumNfe || body.cNumero || body.nNF || '',
        chave: detalhe?.compl?.cChaveNFe || nfe.nChaveNfe || '',
        emissao: detalhe?.ide?.dEmi || nfe.dDataEmisNfe || '',
        valor: detalhe?.total?.ICMSTot?.vNF || null,
        cliente: detalhe?.nfDestInt?.cRazao || ''
      },
      detalhe_nf: detalhe,
      dfe: {
        nfe_completa: extras.nfe_completa || null,
        xml: nfe.cXmlNfe || null,
        pdf_danfe: nfe.cPdf || null,
        portal: nfe.cLinkPortal || null,
        danfe_simplificado: danfeSimp.cPdf || null,
        pedido_pdf: pedidoPdf.cPdfPed || null,
        xml_download_url: downloadDataUrl(nfe.cXmlNfe, 'application/xml')
      },
      pedido_completo: extras.pedido_completo || null,
      bruto: extras,
      erros
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});