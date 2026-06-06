import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function classificarStatus(pedido, etapa) {
  const texto = JSON.stringify(pedido || {}).toLowerCase();
  if (pedido?.infoCadastro?.cancelado === 'S' || texto.includes('cancelad')) return 'cancelada';
  if (texto.includes('rejeitad')) return 'rejeitada';
  if (texto.includes('denegad')) return 'denegada';
  if (etapa === '50') return 'faturar';
  if (etapa === '60') return 'faturado';
  return 'outra_etapa';
}

function extrairNumeroNf(pedido) {
  const json = JSON.stringify(pedido || {});
  const match = json.match(/"(?:nNF|numero_nf|numero_nfe|numeroNotaFiscal|nNumNF)"\s*:\s*"?([^",}]+)"?/i);
  return match?.[1] ? String(match[1]).trim() : '';
}

async function consultarEtapa(base44, codigoPedido) {
  let data;
  try {
    data = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigoPedido) }, { call: 'ConsultarPedido' });
  } catch (e) {
    data = { faultstring: e.message };
  }

  if (data?.faultstring || data?.faultcode) {
    const msg = String(data.faultstring || '').toLowerCase();
    const naoEncontrado = msg.includes('não encontrad') || msg.includes('nao encontrad') ||
      msg.includes('não existe') || msg.includes('nao existe') || msg.includes('inexistente') ||
      msg.includes('excluíd') || msg.includes('excluid');

    return {
      etapa: naoEncontrado ? '80' : null,
      status: naoEncontrado ? 'nao_encontrado' : 'erro',
      numero_nf: '',
      encontrado: false,
      mensagem: data.faultstring || 'Erro Omie'
    };
  }

  const pedido = data?.pedido_venda_produto;
  if (!pedido) {
    return { etapa: null, status: 'nao_encontrado', numero_nf: '', encontrado: false };
  }

  const etapa = String(pedido?.cabecalho?.etapa || '').trim();
  const numeroNf = extrairNumeroNf(pedido);

  return {
    etapa,
    status: classificarStatus(pedido, etapa),
    numero_nf: numeroNf,
    encontrado: true
  };
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
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const codigos = [...new Set((Array.isArray(body.codigos_pedido) ? body.codigos_pedido : [])
      .map(c => String(c))
      .filter(Boolean))]
      .slice(0, 80);

    if (codigos.length === 0) {
      return Response.json({ sucesso: true, resultados: {} });
    }

    const resultados = {};

    for (let i = 0; i < codigos.length; i++) {
      const codigo = codigos[i];
      resultados[codigo] = await consultarEtapa(base44, codigo);
      if (i < codigos.length - 1) await delay(200);
    }

    return Response.json({ sucesso: true, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
});