import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

async function getOmieCredentials(base44) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) return { blocked: false };
  return { blocked: true, blockedUntil: c.bloqueado_ate };
}

// Chamada Omie SEM retry interno: numa reconciliação controlada queremos PARAR no primeiro
// 425/429/redundante, não esperar 55s e retentar. Lança erro com .bloqueio=true se for o caso.
async function omieCallSimples(base44, param, call) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) { const e = new Error(`API Omie bloqueada até ${cb.blockedUntil}`); e.bloqueio = true; throw e; }
  const url = OMIE_BASE_URL + 'produtos/pedido/';
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
  } finally { clearTimeout(tid); }

  if (res.status === 425 || res.status === 429) {
    const corpo = await res.text().catch(() => '');
    const e = new Error(`HTTP ${res.status} Omie: ${corpo.slice(0, 160)}`); e.bloqueio = true; throw e;
  }
  if (res.status >= 500) {
    const corpo = await res.text().catch(() => '');
    if (/redundante/i.test(corpo)) { const e = new Error('Consumo redundante (500)'); e.bloqueio = true; throw e; }
    throw new Error(`HTTP ${res.status} Omie: ${corpo.slice(0, 160)}`);
  }
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    if (msg.includes('consumo indevido') || msg.includes('redundante') || msg.includes('bloquead')) {
      const e = new Error(data.faultstring); e.bloqueio = true; throw e;
    }
    throw new Error(data.faultstring);
  }
  return data;
}
// ═══ fim omieClient inline ═══

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { codigos } = body; // array de omie_codigo_pedido (lote de até 5)
    if (!Array.isArray(codigos) || codigos.length === 0) {
      return Response.json({ error: 'Informe codigos: string[] (omie_codigo_pedido)' }, { status: 400 });
    }

    const resultado = [];
    let parou = null;

    for (let i = 0; i < codigos.length; i++) {
      const cod = String(codigos[i]);
      try {
        const data = await omieCallSimples(base44, { codigo_pedido: Number(cod) }, 'ConsultarPedido');
        const pedido = data.pedido_venda_produto;
        if (!pedido) { resultado.push({ cod, status: 'nao_retornado' }); await sleep(2000); continue; }

        const cab = pedido.cabecalho || {};
        const etapaRaw = String(cab.etapa || '').trim();
        const numeroNf = pedido.informacoes_adicionais?.numero_nf || cab.numero_nf || pedido.nfe?.nNF || null;
        const chaveNf = pedido.nfe?.chave_nfe || pedido.informacoes_adicionais?.chave_nfe || null;

        // Buscar Pedido local
        const peds = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: cod });
        const pedLocal = peds[0];

        if (etapaRaw === '60') {
          // Faturado no Omie
          if (pedLocal) {
            const patch = { status: 'faturado', status_faturamento: 'faturado', faturado: true, data_faturamento: new Date().toISOString(), pendente_emissao: false, motivo_pendencia_emissao: null, omie_erro: null };
            if (numeroNf) patch.numero_nota_fiscal = String(numeroNf);
            if (chaveNf) patch.chave_nfe = String(chaveNf);
            await base44.asServiceRole.entities.Pedido.update(pedLocal.id, patch).catch(() => null);
          }
          // LogEmissaoNF → autorizada
          const logs = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: cod });
          for (const l of logs) {
            const lp = { status: 'autorizada' };
            if (numeroNf) lp.numero_nf = String(numeroNf);
            if (chaveNf) lp.chave_nfe = String(chaveNf);
            await base44.asServiceRole.entities.LogEmissaoNF.update(l.id, lp).catch(() => null);
          }
          // Espelho → 60. Só inclui numero_nf no $set se de fato veio (evita zerar campo existente).
          const espSet = { etapa: '60', sincronizado_em: new Date().toISOString() };
          if (numeroNf) espSet.numero_nf = String(numeroNf);
          await base44.asServiceRole.entities.PedidoLiberadoOmie.updateMany(
            { codigo_pedido: cod }, { $set: espSet }
          ).catch(() => null);
          resultado.push({ cod, etapa: '60', acao: 'faturado', numero_nf: numeroNf, chave: chaveNf });
        } else if (etapaRaw === '80' || etapaRaw.toLowerCase() === 'cancelado' || cab.cancelado) {
          if (pedLocal) await base44.asServiceRole.entities.Pedido.update(pedLocal.id, { status: 'cancelado', cancelado_no_omie: true }).catch(() => null);
          resultado.push({ cod, etapa: '80', acao: 'cancelado' });
        } else {
          // etapa 50 ou outra — não foi faturado ainda, deixar como está
          resultado.push({ cod, etapa: etapaRaw, acao: 'sem_alteracao' });
        }
      } catch (e) {
        if (e.bloqueio) { parou = { cod, motivo: e.message }; break; }
        resultado.push({ cod, erro: e.message });
      }
      await sleep(2000);
    }

    return Response.json({ sucesso: !parou, processados: resultado.length, resultado, parou });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});