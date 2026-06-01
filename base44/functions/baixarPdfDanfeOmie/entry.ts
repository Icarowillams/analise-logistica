// Baixa o PDF do DANFE de uma NF-e do Omie.
// Usa ObterNfe (endpoint produtos/dfedocs) com nIdNfe para obter cPdf (URL do DANFE),
// faz o fetch no servidor (evita CORS) e devolve em base64.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
const NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const DFE_URL = 'https://app.omie.com.br/api/v1/produtos/dfedocs/';

async function omieCall(base44, url, call, param, opts = {}) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
  const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }) });
    const data = await res.json();
    if (data.faultstring || data.faultcode) {
      const msg = String(data.faultstring || '').toLowerCase();
      if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('indispon')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
      throw new Error(data.faultstring || 'Erro Omie');
    }
    if (logIntegration) await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'sucesso', payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { nIdNF, nCodNF, nNF } = body;

    // Resolver o nIdNfe (id interno do Omie usado em ObterNfe)
    let nIdNfe = Number(nIdNF || nCodNF || 0) || null;

    if (!nIdNfe) {
      // Buscar via ConsultarNF (nfconsultar) usando nNF
      if (!nNF) return Response.json({ error: 'Informe nIdNF, nCodNF ou nNF' }, { status: 400 });
      const detalhe = await omieCall(base44, NF_URL, 'ConsultarNF', { nNF: String(nNF) }, { cacheMinutes: 0 });
      nIdNfe = detalhe?.compl?.nIdNF || detalhe?.nIdNF || detalhe?.nCodNF || null;
      if (!nIdNfe) return Response.json({ error: 'nIdNfe não encontrado para a NF informada' }, { status: 404 });
    }

    const nfe = await omieCall(base44, DFE_URL, 'ObterNfe', { nIdNfe: Number(nIdNfe) }, { cacheMinutes: 0 });
    const pdfUrl = nfe?.cPdf || null;

    if (!pdfUrl) {
      return Response.json({ error: 'PDF DANFE não disponível no Omie para esta NF' }, { status: 404 });
    }

    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) {
      return Response.json({ error: `Falha ao baixar PDF do Omie (HTTP ${pdfRes.status})` }, { status: 502 });
    }
    const buf = await pdfRes.arrayBuffer();
    // Converte para base64 em chunks (evita estouro de stack com PDFs grandes)
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    return Response.json({
      sucesso: true,
      numero: nfe?.cNumNfe || nNF || '',
      chave: nfe?.nChaveNfe || '',
      pdf_base64: base64,
      pdf_url: pdfUrl
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});