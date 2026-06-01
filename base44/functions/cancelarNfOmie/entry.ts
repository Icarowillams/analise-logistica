import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

// Endpoints Omie:
// - /produtos/pedido/ → ConsultarPedido (consulta dados do pedido)
// - /produtos/pedidovendafat/ → CancelarPedidoVenda (cancela NF faturada)
const OMIE_URL_PEDIDO = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_URL_FAT = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  return null;
}
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

async function omieCall(base44, endpoint, param, options = {}) {
  const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
  const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
  const cacheKey = `${endpoint}_${JSON.stringify(param)}`;
  const isReadOnly = /^(Listar|Consultar|Pesquisar|Buscar)/.test(endpoint);
  if (isReadOnly) {
    const cached = getFromMemoryCache(cacheKey);
    if (cached) return cached;
  }
  
  const body = {
    call: endpoint,
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param]
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
  
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://app.omie.com.br/api/v1/geral/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      
      const data = await res.json();
      
      if (!options.skipLog) {
        try {
          await base44.entities.create('LogIntegracaoOmie', {
            endpoint,
            payload_envio: JSON.stringify(param).slice(0, 2000),
            payload_resposta: JSON.stringify(data).slice(0, 2000),
            sucesso: !data.faultcode,
            erro: data.faultstring || null,
            created_date: new Date().toISOString()
          });
        } catch(logErr) { /* silent fail */ }
      }
      if (isReadOnly) setMemoryCache(cacheKey, data);
      
      return data;
    } catch(err) {
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

// Cancela NF/Pedido no Omie e registra Cancelamento local
// body: { codigo_pedido, motivo, origem = 'manual' }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, motivo = '', origem = 'manual' } = body;
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });

    let status = 'cancelado';
    let erroOmie = null;
    let numeroNf = '';
    let valorNf = 0;
    let clienteNome = '';

    try {
      const consulta = await omieCall(base44, 'ConsultarPedido', { codigo_pedido: Number(codigo_pedido) });
      const pedido = consulta.pedido_venda_produto;
      numeroNf = pedido?.informacoes_adicionais?.numero_nfe || '';
      valorNf = pedido?.total_pedido?.valor_total_pedido || 0;
      clienteNome = pedido?.cabecalho?.codigo_cliente || '';
    } catch (_) { /* ignore */ }

    // CancelarPedidoVenda fica em /produtos/pedidovendafat/ (endpoint de faturamento)
    try {
      await omieCall(base44, 'CancelarPedidoVenda', {
        nCodPed: Number(codigo_pedido),
        cJustCanc: motivo || `Cancelamento via ${origem}`
      });
    } catch (err) {
      const msg = err.message.toLowerCase();
      if (msg.includes('já') || msg.includes('ja cancelado') || msg.includes('cancelado')) {
        status = 'ja_cancelado';
      } else {
        status = 'erro';
        erroOmie = err.message;
      }
    }

    const registro = await base44.asServiceRole.entities.Cancelamento.create({
      pedido_codigo_omie: String(codigo_pedido),
      numero_nf: String(numeroNf),
      valor_nf: Number(valorNf) || 0,
      cliente_nome: String(clienteNome),
      data_cancelamento: new Date().toISOString(),
      motivo,
      origem,
      funcionario_nome: user.full_name || user.email,
      status,
      erro_omie: erroOmie
    });

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedidovendafat',
      call: 'CancelarPedidoVenda',
      operacao: `cancelar_${origem}`,
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: status === 'erro' ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({ sucesso: status !== 'erro', status, registro_id: registro.id, erro: erroOmie });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});