import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  return null;
}
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

// omieCall robusto: circuit breaker + 425 (bloqueio 30min, sem retry) + retry 429 + log padronizado.
async function omieCall(base44, call, param, options = {}) {
  const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
  const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) throw new Error('Credenciais Omie não configuradas: OMIE_APP_KEY/OMIE_APP_SECRET.');
  console.log(`[liberarPedidoOmie] Conectando ao Omie com APP_KEY: ...${String(OMIE_APP_KEY).slice(-4)} | método: ${call}`);
  const maxTentativas = options.maxTentativas || 3;
  const url = OMIE_URL;
  const cacheKey = `${call}_${JSON.stringify(param)}`;
  const isReadOnly = /^(Listar|Consultar|Pesquisar|Buscar)/.test(call);
  if (isReadOnly) {
    const cached = getFromMemoryCache(cacheKey);
    if (cached) return cached;
  }

  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    const err = new Error(`API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`);
    err.code = 'OMIE_425';
    err.bloqueado_ate = controle.bloqueado_ate;
    throw err;
  }

  const body = { call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] };
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();

      if (data.faultstring || data.faultcode) {
        const msg = String(data.faultstring || '').toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloquead') || msg.includes('bloqueio')) {
          const bloqueadoAte = new Date(Date.now() + 30 * 60000).toISOString();
          const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: bloqueadoAte, ultimo_erro: data.faultstring || 'HTTP 425 consumo indevido', atualizado_em: new Date().toISOString() };
          if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
          else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
          await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: url, call, operacao: call, status: 'erro', codigo_erro: '425',
            mensagem_erro: data.faultstring || 'HTTP 425 — consumo indevido',
            payload_enviado: JSON.stringify(param || {}).slice(0, 2000),
            payload_resposta: JSON.stringify(data || {}).slice(0, 2000)
          }).catch(() => {});
          const err = new Error(`API Omie bloqueada por consumo indevido (HTTP 425). Desbloqueio previsto: ${new Date(bloqueadoAte).toLocaleString('pt-BR')}.`);
          err.code = 'OMIE_425';
          err.bloqueado_ate = bloqueadoAte;
          throw err;
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('indispon')) {
          lastError = data.faultstring;
          if (tentativa < maxTentativas) { await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
        }
        return data;
      }

      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: url, call, operacao: call, status: 'sucesso',
          payload_enviado: JSON.stringify(param || {}).slice(0, 2000),
          payload_resposta: JSON.stringify(data || {}).slice(0, 2000)
        }).catch(() => {});
      }
      if (isReadOnly) setMemoryCache(cacheKey, data);
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.code === 'OMIE_425') throw err;
      lastError = err.message;
      if (tentativa < maxTentativas) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, tentativa)));
    }
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // P7-prep (16/05): permissão granular — admin sempre passa,
        // demais usuários precisam ter `permissoes_pedidos.enviar_pedido` ativo
        // (mesma permissão que já controla envio ao Omie).
        if (user.role !== 'admin') {
            const allVendedores = await base44.asServiceRole.entities.Vendedor.list();
            const vendedor = allVendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
            if (!vendedor) {
                return Response.json({ error: 'Funcionário não encontrado no cadastro' }, { status: 403 });
            }
            const permissoes = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedor.id });
            const perm = permissoes[0];
            if (!perm?.permissoes_pedidos?.enviar_pedido) {
                return Response.json({ error: 'Sem permissão para liberar pedidos' }, { status: 403 });
            }
        }

        const body = await req.json();
        const { pedido_id, etapa } = body;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        // etapa: "10" = Pedido de Venda, "20" = Pedidos Liberados (Separar)
        const etapaOmie = etapa || "20";

        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
            return Response.json({ sucesso: true, mensagem: 'Pedido não está no Omie, operação apenas local' });
        }

        if (pedido.tipo === 'troca') {
            return Response.json({ sucesso: true, mensagem: 'Pedido de Troca não integra com Omie' });
        }

        const codigoPedidoOmie = Number(pedido.omie_codigo_pedido);
        if (!codigoPedidoOmie || isNaN(codigoPedidoOmie)) {
            console.error(`[liberarPedidoOmie] codigo_pedido inválido: ${pedido.omie_codigo_pedido} (tipo: ${typeof pedido.omie_codigo_pedido})`);
            return Response.json({ sucesso: false, erro: `Código do pedido Omie inválido: ${pedido.omie_codigo_pedido}` });
        }

        const etapaLabel = etapaOmie === "20" ? "Pedidos Liberados" : "Pedido de Venda";
        console.log(`[liberarPedidoOmie] Alterando etapa do pedido ${codigoPedidoOmie} para ${etapaOmie} (${etapaLabel})`);

        const param = {
            codigo_pedido: codigoPedidoOmie,
            etapa: etapaOmie
        };

        console.log('[liberarPedidoOmie] Payload:', JSON.stringify(param));

        const resultado = await omieCall(base44, "TrocarEtapaPedido", param);
        console.log('[liberarPedidoOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            console.error('[liberarPedidoOmie] Erro Omie:', resultado.faultstring);
            return Response.json({ sucesso: false, erro: resultado.faultstring });
        }

        console.log(`[liberarPedidoOmie] Pedido ${codigoPedidoOmie} movido para ${etapaLabel} no Omie com sucesso!`);
        return Response.json({ sucesso: true, mensagem: `Pedido movido para ${etapaLabel} no Omie` });

    } catch (error) {
        console.error('[liberarPedidoOmie] Erro:', error.message);
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, sucesso: false, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});