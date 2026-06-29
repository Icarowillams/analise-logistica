import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';


// CORREÇÃO DEFINITIVA: usar ConsultarNF (aceita nIdPedido) por pedido, em vez de varrer ListarNF.
// ListarNF não aceita nIdPedido e disparava CÓDIGO 6 (consumo redundante).
// ConsultarNF retorna a NF do pedido em UMA chamada. Retry único espaçado em caso de CÓDIGO 6.
async function consultarNFporPedido(base44, codigoPedido) {
  let tentativa = 0;
  while (tentativa < 2) {
    try {
      const resp = await omieCall(base44, 'produtos/nfconsultar/', {
        nIdPedido: Number(codigoPedido)
      }, { call: 'ConsultarNF' });
      if (resp?.faultstring) throw new Error(resp.faultstring);
      const ide = resp?.ide || {};
      const compl = resp?.compl || {};
      const numero = ide.nNF || resp?.cNumero || '';
      if (!numero) return null;
      const cStat = String(ide.cStat || compl.cStat || '').trim();
      if (cStat && cStat !== '100' && cStat !== '150') return null; // não autorizada
      return {
        numero_nf: String(numero),
        serie: String(ide.serie || ''),
        chave_nfe: compl.cChaveNFe || '',
        id_nf: compl.nIdNF ? String(compl.nIdNF) : '',
        data: ide.dEmi || new Date().toISOString()
      };
    } catch (e) {
      const msg = String(e.message || '').toLowerCase();
      if (/n[ãa]o existem registros|nenhuma nota/i.test(msg)) return null;
      const redundante = msg.includes('redundante') || msg.includes('aguarde') || msg.includes('código 6') || msg.includes('codigo 6');
      if (redundante && tentativa === 0) {
        await new Promise(r => setTimeout(r, 3000));
        tentativa++;
        continue;
      }
      throw e;
    }
  }
  return null;
}

async function getOmieCredentials(base44: any) {
  // ENV PRIMEIRO (fonte de verdade). Banco só como fallback.
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  if (rows.length > 0 && rows[0].bloqueado) {
    const ate = new Date(rows[0].bloqueado_ate || 0);
    if (ate > new Date()) throw new Error(`Circuit breaker ativo até ${ate.toISOString()}`);
  }
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  await checkCircuitBreaker(base44);
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas');
  const call = options.call || endpoint;
  const url = `https://app.omie.com.br/api/v1/${endpoint}`;
  const body = JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Omie ${call} HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const limite = body.limite || 500;
    const maxConsultas = body.max_consultas || 60; // teto de chamadas Omie por execução
    const pedidos = await base44.asServiceRole.entities.Pedido.list('-updated_date', limite);
    const candidatos = pedidos
      .filter(p => p.omie_codigo_pedido && p.status_faturamento !== 'faturado' && !p.numero_nota_fiscal)
      .slice(0, maxConsultas);

    let atualizados = 0;
    let consultados = 0;
    // Sequencial, com delay anti-rate-limit entre cada ConsultarNF (1 chamada por pedido)
    for (let i = 0; i < candidatos.length; i++) {
      const pedido = candidatos[i];
      let nf = null;
      try {
        nf = await consultarNFporPedido(base44, pedido.omie_codigo_pedido);
      } catch (e) {
        const msg = String(e.message || '').toLowerCase();
        if (msg.includes('circuit breaker') || msg.includes('bloque')) break; // para tudo se bloqueado
        consultados++;
        if (i < candidatos.length - 1) await new Promise(r => setTimeout(r, 1800));
        continue;
      }
      consultados++;
      if (nf?.numero_nf) {
        await base44.asServiceRole.entities.Pedido.update(pedido.id, {
          status: 'faturado',
          faturado: true,
          status_faturamento: 'faturado',
          numero_nota_fiscal: nf.numero_nf,
          data_faturamento: nf.data || new Date().toISOString()
        });
        atualizados++;
      }
      // Delay entre chamadas (não no último)
      if (i < candidatos.length - 1) await new Promise(r => setTimeout(r, 1800));
    }

    return Response.json({ sucesso: true, analisados: candidatos.length, consultados, atualizados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});