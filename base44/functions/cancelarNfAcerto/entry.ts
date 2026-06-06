import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.omie_app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.omie_app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
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
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
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

// ENDPOINTS (doc oficial Omie):
// - /produtos/pedido/        → ConsultarPedido     (param: { codigo_pedido })
// - /produtos/nfconsultar/   → ListarNF            (param: { pagina, registros_por_pagina, ordenar_por, dEmiInicial, dEmiFinal, cCPFCNPJDest })
// - /produtos/pedidovendafat/→ CancelarPedidoVenda (param: { nCodPed })
//
// RETORNO ListarNF → array nfCadastro, onde cada item tem:
//   ide.nNF              → número da NF
//   ide.dCan             → data de cancelamento (se preenchido = cancelada)
//   nfDestInt.cnpj_cpf   → CNPJ/CPF do destinatário
//   total.ICMSTot.vNF    → valor total da NF

const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');


function pad2(n) { return String(n).padStart(2, '0'); }
function dataBR(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { codigo_pedido, motivo = 'Cancelado no acerto de caixa' } = await req.json().catch(() => ({}));
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });

    // ───────────────────────────────────────────────────────────
    // 1) ConsultarPedido — pega CNPJ do cliente e valor total
    //    (doc: /produtos/pedido/ ConsultarPedido { codigo_pedido })
    // ───────────────────────────────────────────────────────────
    const consulta = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigo_pedido) }, { call: 'ConsultarPedido' });
    if (consulta.faultstring) {
      const fs = consulta.faultstring.toLowerCase();
      if (fs.includes('cancelad') || fs.includes('excluíd') || fs.includes('excluid') || fs.includes('não encontrad') || fs.includes('nao encontrad')) {
        return Response.json({ sucesso: true, ja_cancelada: true, mensagem: 'Pedido já cancelado/excluído no Omie' });
      }
      return Response.json({ error: consulta.faultstring }, { status: 400 });
    }
    const ped = consulta.pedido_venda_produto;
    if (!ped) return Response.json({ error: 'Pedido não retornado pelo Omie' }, { status: 400 });

    const codigoCliente = Number(ped?.cabecalho?.codigo_cliente || 0);
    const valorPedido = Number(ped?.total_pedido?.valor_total_pedido || 0);
    const dataPrev = ped?.cabecalho?.data_previsao || '';

    // ───────────────────────────────────────────────────────────
    // 2) ListarNF — procura NF pelo nCodCli + valor, últimos 2 meses
    //    Match composto: nfDestInt.nCodCli == codigoCliente E |vNF - valor| < 0.05
    //    Ignora NF de entrada (tpNF != "1")
    // ───────────────────────────────────────────────────────────
    let numeroNf = '';
    let nfJaCancelada = false;

    if (codigoCliente) {
      const hoje = new Date();
      const ini = new Date(); ini.setMonth(ini.getMonth() - 2);

      const param = {
        pagina: 1,
        registros_por_pagina: 100,
        ordenar_por: 'CODIGO',
        ordem_decrescente: 'S',
        filtrar_por_data_de: dataBR(ini),
        filtrar_por_data_ate: dataBR(hoje)
      };

      for (let pagina = 1; pagina <= 5; pagina++) {
        param.pagina = pagina;
        const resp = await omieCall(base44, 'produtos/nfconsultar/', param, { call: 'ListarNF' });
        const lista = resp?.nfCadastro || [];
        if (lista.length === 0) break;

        const match = lista.find(nf => {
          // Ignora NF de entrada
          const tpNF = String(nf?.ide?.tpNF ?? '');
          if (tpNF && tpNF !== '1') return false;
          const nCodCli = Number(nf?.nfDestInt?.nCodCli || 0);
          if (nCodCli !== codigoCliente) return false;
          const vNF = Number(nf?.total?.ICMSTot?.vNF || 0);
          return Math.abs(vNF - valorPedido) < 0.05;
        });

        if (match) {
          numeroNf = match?.ide?.nNF || '';
          if (match?.ide?.dCan) nfJaCancelada = true;
          break;
        }

        const totalPag = Number(resp?.nTotPaginas || resp?.total_de_paginas || 1);
        if (pagina >= totalPag) break;
      }
    }

    if (nfJaCancelada) {
      // NF já cancelada no Omie → só atualiza local e retorna
      await atualizarPedidoLocal(base44, codigo_pedido, motivo, user);
      return Response.json({ sucesso: true, ja_cancelada: true, numero_nf: numeroNf, mensagem: 'NF já estava cancelada no Omie' });
    }

    // ───────────────────────────────────────────────────────────
    // 3) CancelarPedidoVenda
    //    (doc: /produtos/pedidovendafat/ CancelarPedidoVenda { nCodPed })
    // ───────────────────────────────────────────────────────────
    const cancel = await omieCall(base44, 'produtos/pedidovendafat/', { nCodPed: Number(codigo_pedido) }, { call: 'CancelarPedidoVenda' });
    if (cancel.faultstring) {
      const fs = cancel.faultstring.toLowerCase();
      if (fs.includes('cancelad') || fs.includes('já foi') || fs.includes('ja foi')) {
        await atualizarPedidoLocal(base44, codigo_pedido, motivo, user);
        return Response.json({ sucesso: true, ja_cancelada: true, numero_nf: numeroNf, mensagem: 'Já cancelado no Omie' });
      }
      return Response.json({ error: cancel.faultstring, numero_nf: numeroNf }, { status: 400 });
    }

    // ───────────────────────────────────────────────────────────
    // 4) Atualiza Pedido local (comercial + logística mesmo app)
    // ───────────────────────────────────────────────────────────
    await atualizarPedidoLocal(base44, codigo_pedido, motivo, user);

    return Response.json({
      sucesso: true,
      numero_nf: numeroNf,
      data_previsao: dataPrev,
      mensagem: 'Pedido cancelado no Omie' + (numeroNf ? ` (NF ${numeroNf})` : '')
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function atualizarPedidoLocal(base44, codigoPedido, motivo, user) {
  try {
    const lista = await base44.asServiceRole.entities.Pedido.filter(
      { omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1
    );
    if (lista?.[0]) {
      await base44.asServiceRole.entities.Pedido.update(lista[0].id, {
        status: 'cancelado',
        motivo_cancelamento: motivo,
        cancelado_por: user.email,
        cancelado_por_nome: user.full_name || user.email,
        data_cancelamento: new Date().toISOString()
      });
    }
  } catch (_) {}
}