import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

async function omieCall(base44, call, param, opts = {}) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
  const url = OMIE_URL;
  const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    const err = new Error(`API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`);
    err.code = 'OMIE_425';
    err.bloqueado_ate = controle.bloqueado_ate;
    throw err;
  }
  if (cacheMinutes > 0) {
    const caches = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
    if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
  }
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }) });
    const data = await res.json();
    if (data.faultstring || data.faultcode) {
      const msg = String(data.faultstring || '').toLowerCase();
      if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
        const bloqueadoAte = new Date(Date.now() + 30 * 60000).toISOString();
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: bloqueadoAte, ultimo_erro: data.faultstring || 'HTTP 425 consumo indevido', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'erro', codigo_erro: '425', mensagem_erro: data.faultstring || 'HTTP 425 — consumo indevido', payload_enviado: JSON.stringify(param || {}).slice(0, 2000), payload_resposta: JSON.stringify(data || {}).slice(0, 2000) }).catch(() => {});
        const err = new Error(`API Omie bloqueada por consumo indevido (HTTP 425). Desbloqueio previsto: ${new Date(bloqueadoAte).toLocaleString('pt-BR')}.`);
        err.code = 'OMIE_425';
        err.bloqueado_ate = bloqueadoAte;
        throw err;
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
      throw new Error(data.faultstring || 'Erro Omie');
    }
    if (cacheMinutes > 0) {
      const payloadCache = { chave, valor: data, tipo: call, expira_em: new Date(Date.now() + cacheMinutes * 60000).toISOString(), criado_em: new Date().toISOString() };
      const existente = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
      if (existente?.[0]?.id) await base44.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payloadCache).catch(() => {}); else await base44.asServiceRole.entities.CacheOmieConsulta.create(payloadCache).catch(() => {});
    }
    if (logIntegration) await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'sucesso', payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

function pedidoCancelado(pedido) {
  const texto = JSON.stringify(pedido || {}).toLowerCase();
  return texto.includes('cancelado') || texto.includes('cancelada');
}

// Consulta bruta de um pedido no Omie (retorna o objeto pedido_venda_produto completo)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, codigo_pedido_integracao } = body;
    if (!codigo_pedido && !codigo_pedido_integracao) {
      return Response.json({ error: 'codigo_pedido ou codigo_pedido_integracao obrigatório' }, { status: 400 });
    }

    const param = {};
    if (codigo_pedido) param.codigo_pedido = Number(codigo_pedido);
    if (codigo_pedido_integracao) param.codigo_pedido_integracao = String(codigo_pedido_integracao);

    const data = await omieCall(base44, 'ConsultarPedido', param, { cacheMinutes: 10 });
    const pedido = data.pedido_venda_produto;

    if (!pedido) return Response.json({ error: 'Pedido não retornado pelo Omie' }, { status: 404 });

    const cancelado = pedidoCancelado(pedido);
    pedido.cabecalho = {
      ...(pedido.cabecalho || {}),
      cancelado,
      status_pedido: cancelado ? 'cancelado' : (pedido.cabecalho?.status_pedido || pedido.cabecalho?.status || ''),
      etapa: cancelado ? 'cancelado' : pedido.cabecalho?.etapa
    };

    return Response.json({ sucesso: true, pedido });
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});