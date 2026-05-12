// Baixa o PDF de um boleto Omie a partir do codigo_lancamento.
// 1) Chama ObterBoleto (financas/contareceber) para obter cLinkBoleto.
// 2) Faz fetch do PDF no servidor (evita CORS) e devolve em base64.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
const CR_URL = 'https://app.omie.com.br/api/v1/financas/contareceber/';

async function omieCall(url, call, param, tentativa = 1) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring || '').toLowerCase();
    const fc = String(data.faultcode || '');
    const retry = res.status === 429 || fc.includes('425') || fc.includes('520')
      || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('indispon');
    if (retry && tentativa < 4) {
      await new Promise(r => setTimeout(r, 2500 * tentativa));
      return omieCall(url, call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_lancamento, url_boleto } = body;

    let link = url_boleto || null;

    if (!link) {
      if (!codigo_lancamento) {
        return Response.json({ error: 'Informe codigo_lancamento ou url_boleto' }, { status: 400 });
      }
      const data = await omieCall(CR_URL, 'ObterBoleto', { codigo_lancamento: Number(codigo_lancamento) });
      link = data?.cLinkBoleto || data?.link_boleto || null;
      if (!link) {
        return Response.json({ error: 'Link do boleto indisponível no Omie' }, { status: 404 });
      }
    }

    const pdfRes = await fetch(link);
    if (!pdfRes.ok) {
      return Response.json({ error: `Falha ao baixar PDF do Omie (HTTP ${pdfRes.status})` }, { status: 502 });
    }
    const buf = await pdfRes.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    return Response.json({
      sucesso: true,
      codigo_lancamento,
      pdf_url: link,
      pdf_base64: base64
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});