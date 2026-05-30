import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

const ETAPA_LABELS = {
  '10': 'Pedido de Venda',
  '20': 'Pedido Liberado',
  '50': 'Faturar',
  '60': 'Faturado',
  '70': 'Entrega/Cancelado',
  '80': 'Excluído/Cancelado'
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isErroTransitorio(response, data) {
  const msg = String(data?.faultstring || '').toLowerCase();
  const code = String(data?.faultcode || '').toLowerCase();
  return response.status === 408 || response.status === 429 || response.status >= 500 ||
    msg.includes('cota') || msg.includes('limite') || msg.includes('aguarde') ||
    msg.includes('timeout') || msg.includes('tempor') || msg.includes('indispon') ||
    code.includes('425') || code.includes('429') || code.includes('timeout');
}

function isNaoEncontrado(data) {
  const msg = String(data?.faultstring || '').toLowerCase();
  return msg.includes('não encontrad') || msg.includes('nao encontrad') ||
    msg.includes('não existe') || msg.includes('nao existe') ||
    msg.includes('inexistente') || msg.includes('excluíd') || msg.includes('excluid');
}

function extrairNumeroNf(pedido) {
  const json = JSON.stringify(pedido || {});
  const match = json.match(/"(?:nNF|numero_nf|numero_nfe|numeroNotaFiscal|nNumNF)"\s*:\s*"?([^",}]+)"?/i);
  return match?.[1] ? String(match[1]).trim() : '';
}

function extrairStatus(pedido, etapa, numeroNf) {
  const texto = JSON.stringify(pedido || {}).toLowerCase();
  if (texto.includes('rejeitad')) return 'rejeitada';
  if (texto.includes('denegad')) return 'denegada';
  if (texto.includes('cancelad') || pedido?.infoCadastro?.cancelado === 'S') return 'cancelada';
  if (numeroNf || etapa === '60') return 'emitida';
  if (etapa === '50') return 'faturar';
  return ETAPA_LABELS[etapa] || 'outra_etapa';
}

async function consultarPedidoOmie(codigoPedido) {
  let ultimoErro = null;

  for (let tentativa = 0; tentativa < 3; tentativa++) {
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

    const text = await response.text();
    const data = JSON.parse(text || '{}');

    if (data?.faultstring || data?.faultcode) {
      if (isNaoEncontrado(data)) {
        return { etapa: '80', status: 'nao_encontrado', numero_nf: '', encontrado: false, mensagem: data.faultstring || '' };
      }
      if (isErroTransitorio(response, data) && tentativa < 2) {
        ultimoErro = data.faultstring || 'Erro transitório Omie';
        await delay(1500 * (tentativa + 1));
        continue;
      }
      return { etapa: null, status: 'erro', numero_nf: '', encontrado: false, mensagem: data.faultstring || 'Erro Omie' };
    }

    const pedido = data?.pedido_venda_produto;
    if (!pedido) return { etapa: null, status: 'nao_encontrado', numero_nf: '', encontrado: false, mensagem: 'Pedido não retornado pelo Omie' };

    const etapa = String(pedido?.cabecalho?.etapa || '').trim();
    const numeroNf = extrairNumeroNf(pedido);
    const status = extrairStatus(pedido, etapa, numeroNf);

    return {
      etapa,
      status,
      numero_nf: numeroNf,
      encontrado: true,
      mensagem: ETAPA_LABELS[etapa] || status
    };
  }

  return { etapa: null, status: 'erro', numero_nf: '', encontrado: false, mensagem: ultimoErro || 'Falha ao consultar Omie' };
}

async function atualizarEspelho(base44, codigoPedido, dados) {
  const registros = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []);
  const atual = registros?.[0];
  if (!atual?.id) return;

  const payload = {
    etapa: dados.etapa || atual.etapa,
    status_real: dados.status || atual.status_real,
    status_label: dados.mensagem || atual.status_label,
    numero_nf: dados.numero_nf || '',
    sincronizado_em: new Date().toISOString(),
    origem_sync: 'reconciliacao'
  };

  if (atual.etapa !== payload.etapa || atual.status_real !== payload.status_real || String(atual.numero_nf || '') !== String(payload.numero_nf || '')) {
    await base44.asServiceRole.entities.PedidoLiberadoOmie.update(atual.id, payload).catch(() => {});
  }
}

async function atualizarCarga(base44, codigoPedido, dados) {
  if (!(dados.status === 'nao_encontrado' || dados.etapa === '70' || dados.etapa === '80' || dados.status === 'cancelada')) return;

  const cargas = await base44.asServiceRole.entities.Carga.filter({ status_carga: 'faturada' }, '-updated_date', 200).catch(() => []);
  for (const carga of cargas) {
    const pedidosOmie = Array.isArray(carga.pedidos_omie) ? carga.pedidos_omie : [];
    let alterou = false;
    const pedidosAtualizados = pedidosOmie.map(p => {
      if (String(p.codigo_pedido) !== String(codigoPedido)) return p;
      alterou = true;
      return { ...p, numero_nf: '' };
    });

    if (alterou) {
      await base44.asServiceRole.entities.Carga.update(carga.id, {
        pedidos_omie: pedidosAtualizados,
        status_carga: 'faturada_com_rejeicao'
      }).catch(() => {});
    }
  }
}

async function atualizarPedidoLocal(base44, codigoPedido, dados) {
  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []);
  const pedido = pedidos?.[0];
  if (!pedido?.id) return;

  if (dados.status === 'nao_encontrado' || dados.etapa === '70' || dados.etapa === '80' || dados.status === 'cancelada') {
    await base44.asServiceRole.entities.Pedido.update(pedido.id, {
      status: 'cancelado',
      status_faturamento: 'pendente',
      motivo_cancelamento: `Atualizado por consulta direta ao Omie: ${dados.mensagem || dados.status}`,
      data_cancelamento: new Date().toISOString(),
      cancelado_por: 'sistema',
      cancelado_por_nome: 'Consulta direta Omie'
    }).catch(() => {});
    return;
  }

  if (dados.etapa === '60' || dados.numero_nf || dados.status === 'emitida') {
    await base44.asServiceRole.entities.Pedido.update(pedido.id, {
      status: 'faturado',
      status_faturamento: 'faturado',
      faturado: true,
      numero_nota_fiscal: dados.numero_nf || pedido.numero_nota_fiscal || '',
      data_faturamento: pedido.data_faturamento || new Date().toISOString()
    }).catch(() => {});
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const codigosPedido = Array.isArray(body.codigos_pedido) ? body.codigos_pedido : [];
    if (codigosPedido.length === 0) return Response.json({ error: 'codigos_pedido é obrigatório' }, { status: 400 });

    const resultados = {};
    const codigos = [...new Set(codigosPedido.map(c => String(c)).filter(Boolean))].slice(0, 80);

    for (let i = 0; i < codigos.length; i++) {
      const codigo = codigos[i];
      const dados = await consultarPedidoOmie(codigo);
      resultados[codigo] = dados;

      await atualizarEspelho(base44, codigo, dados);
      await atualizarPedidoLocal(base44, codigo, dados);
      await atualizarCarga(base44, codigo, dados);

      if (i < codigos.length - 1) await delay(800);
    }

    return Response.json({ sucesso: true, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});