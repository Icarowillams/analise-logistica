import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

async function omieCall(base44, call, param, opts = {}) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
  const url = OMIE_URL;
  const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
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
      if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite de requisi') || msg.includes('internal error') || msg.includes('timeout') || msg.includes('indispon')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      data_inicial,
      data_final,
      pagina = 1,
      registros_por_pagina = 100,
      nome_cliente,
      cnpj_cliente
    } = body;

    // Doc Omie: máx 100 registros/página
    const param = { pagina, registros_por_pagina: Math.min(registros_por_pagina, 100) };
    if (data_inicial) param.dEmiInicial = data_inicial;
    if (data_final) param.dEmiFinal = data_final;
    if (nome_cliente) param.cRazao = nome_cliente;
    if (cnpj_cliente) param.cCPFCNPJDest = cnpj_cliente.replace(/\D/g, '');

    const t0 = Date.now();
    const data = await omieCall(base44, 'ListarNF', param, { cacheMinutes: 10 });
    const duracao = Date.now() - t0;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/nfconsultar',
      call: 'ListarNF',
      operacao: 'listar_nfs',
      status: 'sucesso',
      duracao_ms: duracao,
      usuario_email: user.email
    }).catch(() => {});

    // Doc Omie nfconsultar: ListarNF retorna nfStatus.cStat (status SEFAZ real).
    // Códigos SEFAZ comuns:
    //   - 100 = Autorizada
    //   - 101 = Cancelada
    //   - 102 = Inutilizada
    //   - 110 = Denegada (110/301/302)
    //   - 135 = Evento autorizado (carta de correção etc — mantém autorizada)
    //   - 200+ (sem ser 200/135) = Rejeitada
    // Fallback: derivar de ide.dCan / ide.dInut / ide.cDeneg / compl.cChaveNFe
    const derivarStatus = (nf) => {
      const ide = nf.ide || {};
      const compl = nf.compl || {};
      const nfStatus = nf.nfStatus || {};
      const cStat = String(nfStatus.cStat || compl.cStat || '').trim();

      // 1) Códigos SEFAZ explícitos têm prioridade absoluta
      if (cStat) {
        if (cStat === '101') return 'cancelada';
        if (cStat === '102') return 'inutilizada';
        if (cStat === '110' || cStat === '301' || cStat === '302') return 'denegada';
        if (cStat === '100' || cStat === '135') return 'autorizada';
        // Qualquer outro código diferente de 100 = rejeitada/erro
        return 'rejeitada';
      }

      // 2) Fallback por campos de evento
      if (ide.dCan && String(ide.dCan).trim()) return 'cancelada';
      if (ide.cDeneg === 'S' || ide.cDeneg === 'D') return 'denegada';
      if (ide.dInut && String(ide.dInut).trim()) return 'inutilizada';
      if (compl.cChaveNFe && String(compl.cChaveNFe).length >= 40) return 'autorizada';
      return 'pendente';
    };

    const nfs = (data.nfCadastro || []).map(nf => ({
      nIdNF: nf.compl?.nIdNF || nf.nIdNF || nf.nCodNF,
      nCodNF: nf.compl?.nIdNF || nf.nIdNF || nf.nCodNF,
      nIdPedido: nf.compl?.nIdPedido || nf.nIdPedido,
      cNumero: nf.ide?.nNF || nf.cNumero,
      cSerie: nf.ide?.serie || nf.cSerie,
      cChaveNFe: nf.compl?.cChaveNFe || nf.cChaveNFe,
      dEmiNF: nf.ide?.dEmi || nf.dEmiNF,
      hEmiNF: nf.ide?.hEmi || nf.hEmiNF,
      dCanNF: nf.ide?.dCan || null,
      dInutNF: nf.ide?.dInut || null,
      cDeneg: nf.ide?.cDeneg || null,
      cRazao: nf.nfDestInt?.cRazao || nf.cRazao,
      cCPFCNPJDest: nf.nfDestInt?.cnpj_cpf || nf.cCPFCNPJDest,
      nValorNF: nf.total?.ICMSTot?.vNF || nf.nValorNF,
      cStatus: derivarStatus(nf), // 'autorizada' | 'cancelada' | 'denegada' | 'inutilizada' | 'pendente'
      cOperacao: nf.ide?.cNatOp || nf.cOperacao,
      itens: nf.det || [],
      total: nf.total || null,
      nf_raw: nf
    }));

    return Response.json({
      sucesso: true,
      nfs,
      pagina: data.nPagina || data.pagina,
      total_de_paginas: data.nTotPaginas || data.total_de_paginas,
      total_de_registros: data.nRegistros || data.total_de_registros
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});