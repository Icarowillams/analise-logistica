import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const until = new Date(Date.now() + 30 * 60000).toISOString();
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: 'principal', bloqueado: true, bloqueado_ate: until, ultimo_erro: data.faultstring, atualizado_em: new Date().toISOString() }).catch(() => null);
          throw new Error(data.faultstring);
        }
        // REDUNDANT = chamada duplicada em intervalo curto — NÃO fazer retry (só piora)
        if (msg.includes('redundant') || msg.includes('redundante')) { throw new Error(data.faultstring); }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

// ✅ ITEM 7
// Endpoints Omie:
// - /produtos/pedido/ → ConsultarPedido (consulta dados do pedido)
// - /produtos/pedidovendafat/ → CancelarPedidoVenda (cancela NF faturada)
const OMIE_URL_PEDIDO = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_URL_FAT = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';

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
// Roteia ConsultarPedido para /produtos/pedido/ e demais (CancelarPedidoVenda) para /produtos/pedidovendafat/.


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, motivo = '', origem = 'manual', dados_pedido } = body;
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });

    let status = 'cancelado';
    let erroOmie = null;
    let numeroNf = '';
    let valorNf = 0;
    let clienteNome = '';
    let dataFaturamento = null;

    // Se o frontend já enviou os dados do pedido, usa para preencher info (evita ConsultarPedido duplicado / REDUNDANT)
    // IMPORTANTE: NÃO confiar na etapa do frontend para decidir se o pedido está cancelado —
    // sempre tenta cancelar no Omie e deixa a API confirmar se já está cancelado.
    if (dados_pedido) {
      numeroNf = dados_pedido.numero_nfe || '';
      valorNf = Number(dados_pedido.valor_total || 0);
      clienteNome = dados_pedido.cliente_nome || '';
      dataFaturamento = dados_pedido.data_faturamento || null;
    } else {
      // Fallback: consulta o Omie (só se dados não vieram do frontend)
      try {
        const consulta = await omieCall(base44, OMIE_URL_PEDIDO, { codigo_pedido: Number(codigo_pedido) }, { call: 'ConsultarPedido', skipLog: true });
        const pedido = consulta.pedido_venda_produto;
        numeroNf = pedido?.informacoes_adicionais?.numero_nfe || '';
        valorNf = pedido?.total_pedido?.valor_total_pedido || 0;
        clienteNome = pedido?.cabecalho?.codigo_cliente || '';
        dataFaturamento = pedido?.informacoes_adicionais?.dFat || pedido?.cabecalho?.data_previsao || null;
        const etapaAtual = String(pedido?.cabecalho?.etapa || '').toLowerCase();
        if (etapaAtual === 'cancelado' || pedido?.cabecalho?.cancelado === true) {
          status = 'ja_cancelado';
        }
      } catch (_) { /* ignore */ }
    }

    // ═══ REGRA FISCAL: NF-e só pode ser cancelada em até 24h após emissão ═══
    if (status !== 'ja_cancelado' && numeroNf && dataFaturamento) {
      const dtFat = new Date(dataFaturamento);
      if (!isNaN(dtFat.getTime())) {
        const horasDesdeEmissao = (Date.now() - dtFat.getTime()) / (1000 * 60 * 60);
        if (horasDesdeEmissao > 24) {
          const horasFormatadas = Math.floor(horasDesdeEmissao);
          erroOmie = `NF-e ${numeroNf} foi emitida há ${horasFormatadas}h. O prazo máximo para cancelamento é de 24 horas após a emissão. Após esse prazo, é necessário emitir uma NF-e de devolução/estorno.`;
          status = 'erro';

          // Registra o bloqueio e retorna
          const registro = await base44.asServiceRole.entities.Cancelamento.create({
            pedido_codigo_omie: String(codigo_pedido),
            numero_nf: String(numeroNf),
            valor_nf: Number(valorNf) || 0,
            cliente_nome: String(clienteNome),
            data_cancelamento: new Date().toISOString(),
            motivo,
            origem,
            funcionario_nome: user.full_name || user.email,
            status: 'erro',
            erro_omie: erroOmie
          });

          return Response.json({ sucesso: false, status: 'erro', registro_id: registro.id, erro: erroOmie, prazo_expirado: true });
        }
      }
    }

    // Só chama CancelarPedidoVenda se ainda não está cancelado
    if (status !== 'ja_cancelado') {
      try {
        await omieCall(base44, OMIE_URL_FAT, {
          nCodPed: Number(codigo_pedido),
          cJustCanc: motivo || `Cancelamento via ${origem}`
        }, { call: 'CancelarPedidoVenda', operation: `cancelar_${origem}`, entityType: 'Pedido', entityId: String(codigo_pedido) });
      } catch (err) {
        if (err.code === 'OMIE_425') throw err;
        const msg = err.message.toLowerCase();
        // Log detalhado para debug
        console.log('[cancelarNfOmie] Erro CancelarPedidoVenda:', err.message);
        // Só trata como "já cancelado" se a mensagem indicar EXPLICITAMENTE que o pedido já está cancelado
        if (msg.includes('já cancelado') || msg.includes('ja cancelado') || msg.includes('pedido cancelado') || msg.includes('nota cancelada')) {
          status = 'ja_cancelado';
        } else if (msg.includes('redundant') || msg.includes('redundante')) {
          // REDUNDANT = chamada duplicada, NÃO significa que está cancelado
          status = 'erro';
          erroOmie = 'Consumo redundante. Aguarde e tente novamente.';
        } else {
          status = 'erro';
          erroOmie = err.message;
        }
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

    if (status !== 'erro') {
      // 1. Atualiza o Pedido local
      const pedidosLocais = await base44.asServiceRole.entities.Pedido
        .filter({ omie_codigo_pedido: String(codigo_pedido) }, '-updated_date', 1)
        .catch(() => []);
      const pedidoLocal = pedidosLocais?.[0];
      if (pedidoLocal?.id) {
        await base44.asServiceRole.entities.Pedido.update(pedidoLocal.id, {
          status: 'cancelado',
          data_cancelamento: new Date().toISOString(),
          cancelado_por: origem,
          cancelado_por_nome: user.full_name || user.email
        }).catch(() => {});
      }

      // 2. Atualiza o espelho PedidoLiberadoOmie
      const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie
        .filter({ codigo_pedido: String(codigo_pedido) }, '-updated_date', 1)
        .catch(() => []);
      const espelho = espelhos?.[0];
      if (espelho?.id) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelho.id, {
          status_real: 'cancelada',
          etapa: '80'
        }).catch(() => {});
      }

      // 3. Atualiza o snapshot da carga (se o pedido tiver carga_id)
      const cargaId = pedidoLocal?.carga_id;
      if (cargaId) {
        const carga = await base44.asServiceRole.entities.Carga.get(cargaId).catch(() => null);
        if (carga) {
          const novosPedidos = (carga.pedidos_omie || []).map(p =>
            String(p.codigo_pedido) === String(codigo_pedido)
              ? { ...p, cancelado: true, numero_nf: p.numero_nf || '' }
              : p
          );
          await base44.asServiceRole.entities.Carga.update(cargaId, {
            pedidos_omie: novosPedidos
          }).catch(() => {});
        }
      }
    }

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
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});