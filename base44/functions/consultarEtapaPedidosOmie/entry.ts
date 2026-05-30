import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

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

async function consultarEtapa(codigoPedido) {
  const response = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarPedido',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{ codigo_pedido: Number(codigoPedido) }]
    })
  });

  const data = await response.json();

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
      resultados[codigo] = await consultarEtapa(codigo);
      if (i < codigos.length - 1) await delay(200);
    }

    return Response.json({ sucesso: true, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});