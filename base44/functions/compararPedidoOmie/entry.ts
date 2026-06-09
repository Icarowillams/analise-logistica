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

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { pedido_id } = body;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        // Buscar pedido local
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        // Buscar itens locais
        const itensLocais = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });

        // Buscar pedido no Omie
        const omieResponse = await fetch("https://app.omie.com.br/api/v1/produtos/pedido/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ConsultarPedido",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{ codigo_pedido: Number(pedido.omie_codigo_pedido) }]
            })
        });

        const omieResult = await omieResponse.json();

        if (omieResult.faultstring) {
            return Response.json({ 
                sucesso: false, 
                erro: omieResult.faultstring,
                pedido_local: {
                    numero: pedido.numero_pedido,
                    omie_codigo: pedido.omie_codigo_pedido,
                    status: pedido.status,
                    total_itens: pedido.total_itens,
                    valor_total: pedido.valor_total
                },
                itens_locais: itensLocais.map(i => ({
                    produto_id: i.produto_id,
                    produto_codigo: i.produto_codigo,
                    produto_nome: i.produto_nome,
                    quantidade: i.quantidade,
                    valor_unitario: i.valor_unitario
                }))
            });
        }

        const pedidoOmie = omieResult.pedido_venda_produto || omieResult;
        const cabecalho = pedidoOmie.cabecalho || {};
        const det = pedidoOmie.det || [];
        const infAdic = pedidoOmie.informacoes_adicionais || {};

        // Extrair itens do Omie
        const itensOmie = det.map(d => ({
            codigo_item_integracao: d.ide?.codigo_item_integracao,
            codigo_produto: d.produto?.codigo_produto,
            codigo_produto_integracao: d.produto?.codigo_produto_integracao,
            codigo_interno: d.produto?.codigo,
            descricao: d.produto?.descricao,
            ncm: d.produto?.ncm,
            cfop: d.produto?.cfop,
            quantidade: d.produto?.quantidade,
            valor_unitario: d.produto?.valor_unitario,
            unidade: d.produto?.unidade,
            // Dados fiscais do item
            imposto_icms: d.imposto?.icms,
            imposto_pis: d.imposto?.pis,
            imposto_cofins: d.imposto?.cofins,
        }));

        // Comparar
        const comparacao = itensLocais.map(local => {
            const omieItem = itensOmie.find(o => 
                o.codigo_item_integracao === local.id || 
                o.codigo_produto_integracao === local.produto_id
            );
            return {
                local: {
                    id: local.id,
                    produto_id: local.produto_id,
                    produto_codigo: local.produto_codigo,
                    produto_nome: local.produto_nome,
                    quantidade: local.quantidade,
                    valor_unitario: local.valor_unitario
                },
                omie: omieItem || 'NÃO ENCONTRADO NO OMIE',
                match: !!omieItem
            };
        });

        return Response.json({
            sucesso: true,
            pedido_local: {
                numero: pedido.numero_pedido,
                omie_codigo: pedido.omie_codigo_pedido,
                status: pedido.status,
                cliente: pedido.cliente_nome,
                cenario_fiscal: pedido.cenario_fiscal_nome,
                cenario_fiscal_codigo: pedido.cenario_fiscal_codigo,
                total_itens: pedido.total_itens,
                valor_total: pedido.valor_total
            },
            pedido_omie: {
                numero_pedido: cabecalho.numero_pedido,
                codigo_pedido: cabecalho.codigo_pedido,
                etapa: cabecalho.etapa,
                codigo_cliente: cabecalho.codigo_cliente,
                codigo_cenario: cabecalho.codigo_cenario_impostos || infAdic.codigo_cenario_impostos,
                qtd_itens: det.length
            },
            itens_locais: itensLocais.length,
            itens_omie: itensOmie.length,
            itens_omie_detalhe: itensOmie,
            comparacao
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});