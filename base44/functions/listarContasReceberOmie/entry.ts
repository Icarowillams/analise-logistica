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

    // Doc Omie ListarContasReceber (lcrListarRequest):
    // - Vencimento: filtrar_por_data_de / filtrar_por_data_ate
    // - Emissão:    filtrar_por_emissao_de / filtrar_por_emissao_ate
    // - CNPJ:       filtrar_por_cpf_cnpj
    // - Em aberto:  filtrar_apenas_titulos_em_aberto = 'S'
    const param = {
      pagina,
      registros_por_pagina: Math.min(registros_por_pagina, 100),
      apenas_importado_api: 'N',
      exibir_obs: 'S'
    };
    if (filtrar_por_data === 'E') {
      if (data_de) param.filtrar_por_emissao_de = data_de;
      if (data_ate) param.filtrar_por_emissao_ate = data_ate;
    } else {
      if (data_de) param.filtrar_por_data_de = data_de;
      if (data_ate) param.filtrar_por_data_ate = data_ate;
    }
    if (cnpj_cpf) param.filtrar_por_cpf_cnpj = cnpj_cpf;
    if (apenas_pendentes) param.filtrar_apenas_titulos_em_aberto = 'S';

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

    let titulos = titulosRaw.map(t => ({
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
      // boleto.cGerado === 'S' indica que o boleto foi efetivamente gerado no Omie
      boleto_gerado: t.boleto?.cGerado === 'S',
      numero_boleto: t.boleto?.cNumBoleto || t.numero_boleto || '',
      observacao: t.observacao,
      codigo_barras: t.boleto?.cCodBarras || t.codigo_barras || '',
      linha_digitavel: t.boleto?.dLinhaDig || '',
      url_boleto: t.boleto?.cLinkBoleto || '',
      // alguns títulos trazem o nº do pedido vinculado, útil como fallback do documento
      numero_pedido_vinculado:
        t.numero_pedido ||
        t.cNumPedido ||
        t.pedido?.numero_pedido ||
        t.pedido_venda?.numero_pedido ||
        ''
    }));

    // ENRIQUECIMENTO: alguns títulos vêm sem nome_cliente / numero_documento.
    // Preenchemos a partir do cadastro local de Cliente (codigo_omie) e do Pedido (omie_codigo_pedido).
    try {
      const codigosClienteFaltando = [...new Set(titulos
        .filter(t => !t.nome_cliente && t.codigo_cliente)
        .map(t => String(t.codigo_cliente)))];

      let clientesMap = new Map();
      if (codigosClienteFaltando.length > 0) {
        const clientes = await base44.asServiceRole.entities.Cliente.filter({
          codigo_omie: { $in: codigosClienteFaltando }
        });
        clientesMap = new Map(clientes.map(c => [String(c.codigo_omie), c]));
      }

      // Tenta resolver documento/cliente também pelo CNPJ quando faltar
      const cnpjsFaltando = [...new Set(titulos
        .filter(t => !t.nome_cliente && !t.codigo_cliente && t.cnpj_cpf)
        .map(t => String(t.cnpj_cpf).replace(/\D/g, '')))];
      let clientesPorCnpj = new Map();
      if (cnpjsFaltando.length > 0) {
        const clientes2 = await base44.asServiceRole.entities.Cliente.list();
        clientes2.forEach(c => {
          const cn = String(c.cnpj_cpf || '').replace(/\D/g, '');
          if (cn && cnpjsFaltando.includes(cn)) clientesPorCnpj.set(cn, c);
        });
      }

      titulos = titulos.map(t => {
        const enr = { ...t };
        if (!enr.nome_cliente) {
          const c = clientesMap.get(String(enr.codigo_cliente)) ||
                    clientesPorCnpj.get(String(enr.cnpj_cpf || '').replace(/\D/g, ''));
          if (c) {
            enr.nome_cliente = c.nome_fantasia || c.razao_social || enr.nome_cliente;
            if (!enr.cnpj_cpf) enr.cnpj_cpf = c.cnpj_cpf;
          }
        }
        // Fallback do número do documento: usa numero_pedido_vinculado, depois codigo_lancamento
        if (!enr.numero_documento) {
          enr.numero_documento = enr.numero_pedido_vinculado || String(enr.codigo_lancamento || '');
        }
        return enr;
      });
    } catch (e) {
      console.warn('[listarContasReceberOmie] enriquecimento falhou:', e.message);
    }

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