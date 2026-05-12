// Baixa o PDF do DANFE de uma NF-e do Omie.
// Aceita {nIdNF, nCodNF, nNF, nIdPedido} — usa consultarDetalheNotaOmie para obter pdf_danfe,
// faz o fetch do PDF no servidor (evita CORS no browser) e retorna o arquivo binário.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

async function omieCall(endpoint, call, param) {
  const url = `https://app.omie.com.br/api/v1/${endpoint}/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) throw new Error(data.faultstring);
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { nIdNF, nCodNF, nNF, nIdPedido } = body;
    if (!nIdNF && !nCodNF && !nNF && !nIdPedido) {
      return Response.json({ error: 'Identificador da NF é obrigatório' }, { status: 400 });
    }

    // Pega o link do PDF DANFE via ObterNfse
    const params = {};
    if (nIdNF) params.nIdNF = Number(nIdNF);
    if (nCodNF) params.nCodNF = Number(nCodNF);
    if (nNF) params.nNF = Number(nNF);
    if (nIdPedido) params.nIdPedido = Number(nIdPedido);

    const resp = await omieCall('produtos/dfedocs', 'ObterNfse', params);
    const pdfUrl = resp?.cLinkDanfePdf || resp?.cLinkDanfe || resp?.cLinkPdf;

    if (!pdfUrl) {
      return Response.json({ error: 'PDF DANFE não disponível no Omie para esta NF' }, { status: 404 });
    }

    // Fetch do PDF no servidor (evita CORS no browser)
    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) {
      return Response.json({ error: `Falha ao baixar PDF do Omie (HTTP ${pdfRes.status})` }, { status: 502 });
    }
    const buf = await pdfRes.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));

    return Response.json({
      sucesso: true,
      numero: nNF || resp?.cNumero || '',
      chave: resp?.cChaveNFe || '',
      pdf_base64: base64,
      pdf_url: pdfUrl
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});