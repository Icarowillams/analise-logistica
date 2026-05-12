import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

// Doc Omie: backoff em rate limit (425), erros transientes (520) e 429
async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const fc = String(data.faultcode || '');
    const isTransient = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante')
      || msg.includes('limite de requisi') || msg.includes('internal error') || msg.includes('timeout') || msg.includes('indispon')
      || fc.includes('425') || fc.includes('520') || res.status === 429;
    if (isTransient && tentativa < 4) {
      await new Promise(r => setTimeout(r, 2000 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Lista contas a receber do Omie (filtra por período de vencimento/emissão/cliente)
// body: { data_de, data_ate, filtrar_por_data = 'E'|'V', cnpj_cpf, pagina, registros_por_pagina, apenas_pendentes }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      data_de,
      data_ate,
      filtrar_por_data = 'V',
      cnpj_cpf,
      pagina = 1,
      registros_por_pagina = 100,
      apenas_pendentes = true
    } = body;

    // Doc Omie: máx 100 registros/página. Enviar filtros NATIVOS pra economizar quota.
    // filtrar_por_data: 'V' = vencimento, 'E' = emissão
    const param = {
      pagina,
      registros_por_pagina: Math.min(registros_por_pagina, 100),
      apenas_importado_api: 'N'
    };
    if (data_de) param.data_de = data_de;
    if (data_ate) param.data_ate = data_ate;
    if (data_de || data_ate) param.filtrar_por_data = filtrar_por_data;
    if (apenas_pendentes) param.status_titulo = 'ABERTO';

    const t0 = Date.now();
    const data = await omieCall('ListarContasReceber', param);
    const duracao = Date.now() - t0;

    // Parser DD/MM/AAAA → Date
    const parseBR = (s) => {
      if (!s) return null;
      const [d, m, y] = s.split('/');
      return new Date(Number(y), Number(m) - 1, Number(d));
    };
    const dDe = parseBR(data_de);
    const dAte = parseBR(data_ate);
    const cnpjNorm = cnpj_cpf ? cnpj_cpf.replace(/\D/g, '') : null;

    // Pós-filtro: CNPJ + fallback de data caso o Omie não tenha filtrado nativamente.
    // Status já vem filtrado pela API quando apenas_pendentes=true.
    const titulosRaw = (data.conta_receber_cadastro || []).filter(t => {
      if (apenas_pendentes && t.status_titulo && t.status_titulo !== 'ABERTO') return false;
      if (cnpjNorm && (t.cpf_cnpj_cliente || '').replace(/\D/g, '') !== cnpjNorm) return false;
      if (dDe && dAte) {
        const ref = filtrar_por_data === 'E' ? parseBR(t.data_emissao) : parseBR(t.data_vencimento);
        if (!ref || ref < dDe || ref > dAte) return false;
      }
      return true;
    });

    const titulos = titulosRaw.map(t => ({
      codigo_lancamento: t.codigo_lancamento_omie,
      codigo_lancamento_integracao: t.codigo_lancamento_integracao,
      codigo_cliente: t.codigo_cliente_fornecedor,
      numero_documento: t.numero_documento,
      numero_parcela: t.numero_parcela,
      data_emissao: t.data_emissao,
      data_vencimento: t.data_vencimento,
      valor_documento: t.valor_documento,
      valor_pago: t.valor_pago || 0,
      // Status REAL do Omie: ABERTO | PAGO | LIQUIDADO | CANCELADO | PARCIAL | RECEBIDO
      status_titulo: t.status_titulo || 'ABERTO',
      cnpj_cpf: t.cpf_cnpj_cliente,
      nome_cliente: t.nome_cliente,
      id_conta_corrente: t.id_conta_corrente,
      numero_boleto: t.numero_boleto || t.boleto?.cNumBoleto || '',
      observacao: t.observacao,
      codigo_barras: t.codigo_barras || t.boleto?.cCodBarras || '',
      linha_digitavel: t.boleto?.dLinhaDig || '',
      url_boleto: t.boleto?.cLinkBoleto || ''
    }));

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'financas/contareceber',
      call: 'ListarContasReceber',
      operacao: 'listar_contas_receber',
      status: 'sucesso',
      duracao_ms: duracao,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      titulos,
      pagina: data.pagina,
      total_de_paginas: data.total_de_paginas,
      total_de_registros: data.total_de_registros
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});