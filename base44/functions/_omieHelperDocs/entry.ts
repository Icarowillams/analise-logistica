// ============================================================================
// REFERÊNCIA DO HELPER OMIE — COPIAR INLINE EM CADA FUNCTION
// ============================================================================
// Deno não permite import local. Copie o bloco `omieCall` abaixo dentro de
// cada function que for chamar a API Omie.
//
// Uso:
//   const resp = await omieCall(base44, {
//     endpoint: 'geral/clientes',
//     call: 'UpsertCliente',
//     param: { ...payload },
//     operacao: 'enviar_cliente',
//     entidade_tipo: 'Cliente',
//     entidade_id: cliente.id,
//     userEmail: user.email
//   });
// ============================================================================

Deno.serve(() => Response.json({
  info: 'Este arquivo é apenas referência. Veja o código-fonte para copiar o helper omieCall.',
  helper_source: `
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

async function omieCall(base44, { endpoint, call, param, operacao, entidade_tipo, entidade_id, userEmail }) {
  const appKey = Deno.env.get('OMIE_APP_KEY');
  const appSecret = Deno.env.get('OMIE_APP_SECRET');
  if (!appKey || !appSecret) throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET ausentes');

  const url = OMIE_BASE_URL + endpoint + '/';
  const body = {
    call, app_key: appKey, app_secret: appSecret,
    param: Array.isArray(param) ? param : [param]
  };
  const startedAt = Date.now();
  let lastError = null, response = null, attempt = 0;

  for (attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }

      if (json.faultstring || json.faultcode) {
        lastError = { code: json.faultcode, message: json.faultstring };
        const fs = String(json.faultstring || '').toLowerCase();
        if (fs.includes('limite de requisi') || String(json.faultcode || '').includes('425')) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        break;
      }
      response = json;
      break;
    } catch (err) {
      lastError = { code: 'NETWORK', message: err.message };
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }

  const duracao_ms = Date.now() - startedAt;
  const sucesso = !!response;

  try {
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint, call, operacao: operacao || call,
      entidade_tipo, entidade_id,
      status: sucesso ? 'sucesso' : 'erro',
      codigo_erro: lastError?.code,
      mensagem_erro: lastError?.message,
      payload_enviado: JSON.stringify(param).slice(0, 5000),
      payload_resposta: JSON.stringify(response || lastError).slice(0, 5000),
      duracao_ms, tentativas: attempt, usuario_email: userEmail
    });
  } catch (_) {}

  if (!sucesso) {
    const err = new Error(lastError?.message || 'Erro Omie');
    err.omieCode = lastError?.code;
    throw err;
  }
  return response;
}
`
}));