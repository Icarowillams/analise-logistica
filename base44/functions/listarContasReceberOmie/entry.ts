import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_URL = 'https://app.omie.com.br/api/v1/financas/contareceber/';

// Resolve credenciais OBRIGATORIAMENTE da entidade ConfiguracaoOmie (banco).
// Igual a enviarPedidoOmie/consultarClientesOmie — não usa mais Deno.env diretamente.
async function resolverCredsOmie(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  const app_key = ativo?.app_key || Deno.env.get('OMIE_APP_KEY');
  const app_secret = ativo?.app_secret || Deno.env.get('OMIE_APP_SECRET');
  return { app_key, app_secret };
}

async function omieCall(base44, endpoint, param, options = {}) {
  const { app_key, app_secret } = options.creds || await resolverCredsOmie(base44);

  const body = {
    call: endpoint,
    app_key,
    app_secret,
    param: [param]
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
  
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(OMIE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      
      const data = await res.json();
      
      if (!options.skipLog) {
        try {
          await base44.entities.create('LogIntegracaoOmie', {
            endpoint,
            payload_envio: JSON.stringify(param).slice(0, 2000),
            payload_resposta: JSON.stringify(data).slice(0, 2000),
            sucesso: !data.faultcode,
            erro: data.faultstring || null,
            created_date: new Date().toISOString()
          });
        } catch(logErr) { /* silent fail */ }
      }
      
      return data;
    } catch(err) {
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

// Lista contas a receber do Omie (filtra por período de vencimento/emissão/cliente)
// body: { data_de, data_ate, filtrar_por_data = 'E'|'V', cnpj_cpf, pagina, registros_por_pagina, apenas_pendentes }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const creds = await resolverCredsOmie(base44);
    if (!creds.app_key || !creds.app_secret) {
      return Response.json({ error: 'Credenciais Omie não configuradas (ConfiguracaoOmie ativa nem Secrets).' }, { status: 500 });
    }

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
    const data = await omieCall(base44, 'ListarContasReceber', param, { cacheMinutes: 10, creds });
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

    // Pós-filtro: apenas status (CNPJ + data já foram aplicados pela própria API do Omie via
    // filtrar_por_cpf_cnpj / filtrar_por_(emissao|data)_de|ate). Refiltrar aqui pelo CNPJ
    // bruto NÃO funciona porque o Omie nem sempre devolve cpf_cnpj_cliente no resultado.
    const STATUS_EXCLUIR = new Set(['LIQUIDADO', 'PAGO', 'CANCELADO', 'RECEBIDO']);
    const titulosRaw = (data.conta_receber_cadastro || []).filter(t => {
      if (apenas_pendentes && t.status_titulo && STATUS_EXCLUIR.has(t.status_titulo.toUpperCase())) return false;
      return true;
    });
    // Mantém parser pra eventual uso futuro — silenciado abaixo
    void parseBR; void dDe; void dAte; void cnpjNorm;

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
      nome_fantasia: t.nome_fantasia || '',
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
            enr.nome_cliente = c.razao_social || c.nome_fantasia || enr.nome_cliente;
            enr.nome_fantasia = c.nome_fantasia || '';
            if (!enr.cnpj_cpf) enr.cnpj_cpf = c.cnpj_cpf;
          }
        }
        // NÃO inventamos numero_documento: se o título Omie vier sem doc fiscal,
        // mostramos vazio na UI (caso de lançamento manual/avulso, ex: id_origem MANR).
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