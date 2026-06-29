import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = Deno.env.get('OMIE_APP_KEY') || cfg?.app_key || '';
  let appSecret = Deno.env.get('OMIE_APP_SECRET') || cfg?.app_secret || '';
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
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
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

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';


// Converte "YYYY-MM-DD" → "DD/MM/YYYY"
function toOmieDate(iso) {
  if (!iso) return '';
  if (iso.includes('/')) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Atualiza data_previsao de vários pedidos no Omie (AlterarPedidoVenda só com cabecalho)
// body: { pedidos: [{ codigo_pedido, codigo_pedido_integracao, numero_pedido }], data_previsao: "YYYY-MM-DD" | "DD/MM/YYYY" }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { pedidos = [], data_previsao } = await req.json().catch(() => ({}));
    if (!data_previsao) return Response.json({ error: 'data_previsao obrigatória' }, { status: 400 });
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      return Response.json({ sucesso: true, resultados: [], total: 0 });
    }

    const dataOmie = toOmieDate(data_previsao);
    const resultados = [];

    for (const p of pedidos) {
      const cabecalho = { data_previsao: dataOmie };
      if (p.codigo_pedido) cabecalho.codigo_pedido = Number(p.codigo_pedido);
      if (p.codigo_pedido_integracao) cabecalho.codigo_pedido_integracao = String(p.codigo_pedido_integracao);

      try {
        const data = await omieCall(base44, 'produtos/pedido/', { cabecalho }, { call: 'AlterarPedidoVenda' });
        const ok = data.cCodStatus === '0' || data.cCodStatus === 0;

        // Tratar como sucesso quando o Omie rejeita mas o pedido já está em etapa
        // avançada (50/60) — a previsão não pode ser alterada, mas não é um erro real.
        if (!ok) {
          const desc = String(data.cDescStatus || '').toLowerCase();
          const ignoravel = desc.includes('etapa') || desc.includes('faturad') || desc.includes('não permite');
          resultados.push({
            codigo_pedido: p.codigo_pedido,
            numero_pedido: p.numero_pedido,
            sucesso: ignoravel,
            ignorado: ignoravel,
            mensagem: data.cDescStatus || 'Erro desconhecido'
          });
          continue;
        }

        if (ok && p.codigo_pedido) {
          // Atualiza espelho PedidoLiberadoOmie
          const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
            { codigo_pedido: String(p.codigo_pedido) },
            '-created_date',
            1
          );
          if (espelhos?.[0]) {
            await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelhos[0].id, {
              data_previsao: data_previsao,
              sincronizado_em: new Date().toISOString()
            });
          }

          // Atualiza também o Pedido local (data_previsao_entrega é o campo que a tela lê)
          const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter(
            { omie_codigo_pedido: String(p.codigo_pedido) },
            '-created_date',
            1
          );
          if (pedidosLocais?.[0]) {
            await base44.asServiceRole.entities.Pedido.update(pedidosLocais[0].id, {
              data_previsao_entrega: data_previsao
            });
          }
        }

        resultados.push({
          codigo_pedido: p.codigo_pedido,
          numero_pedido: p.numero_pedido,
          sucesso: ok,
          mensagem: data.cDescStatus || ''
        });
      } catch (e) {
        resultados.push({
          codigo_pedido: p.codigo_pedido,
          numero_pedido: p.numero_pedido,
          sucesso: false,
          mensagem: e.message
        });
      }
      await new Promise(r => setTimeout(r, 1200));
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.length - sucessos;

    // Detalhamento dos erros individuais para diagnóstico
    const errosDetalhados = resultados
      .filter(r => !r.sucesso)
      .map(r => `Pedido ${r.numero_pedido || r.codigo_pedido}: ${r.mensagem}`)
      .join(' | ');

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'AlterarPedidoVenda',
      operacao: 'alterar_previsao_lote',
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} pedido(s) falharam: ${errosDetalhados}`.substring(0, 2000) : null,
      erro_detalhado: erros > 0 ? errosDetalhados.substring(0, 2000) : null,
      payload_resposta: erros > 0 ? JSON.stringify(resultados.filter(r => !r.sucesso)).substring(0, 2000) : null,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({ sucesso: true, total: pedidos.length, sucessos, erros, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});