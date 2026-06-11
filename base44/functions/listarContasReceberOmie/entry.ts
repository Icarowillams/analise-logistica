// v2 — 2026-06-06 — enriquecimento bulk (sem N+1 queries)
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_URL = 'https://app.omie.com.br/api/v1/financas/contareceber/';

let _credsCache: any = null;
async function resolverCredsOmie(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  if (ativo?.app_key && ativo?.app_secret) {
    _credsCache = { app_key: String(ativo.app_key), app_secret: String(ativo.app_secret), at: Date.now() };
    return _credsCache;
  }
  _credsCache = { app_key: Deno.env.get('OMIE_APP_KEY') || '', app_secret: Deno.env.get('OMIE_APP_SECRET') || '', at: Date.now() };
  return _credsCache;
}

async function omieCall(base44: any, call: string, param: any, options: any = {}) {
  const creds = options.creds || await resolverCredsOmie(base44);
  const body = { call, app_key: creds.app_key, app_secret: creds.app_secret, param: [param] };
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
    try {
      const res = await fetch(OMIE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.status === 429) { await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); continue; }
      const data = await res.json();
      if (data.faultstring) throw new Error(data.faultstring);
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

// Carrega clientes em bulk (uma única chamada) e indexa por codigo_omie e CNPJ
let _clientesCache: { map: Map<string, any>; cnpjMap: Map<string, any>; at: number } | null = null;
const CLIENTES_CACHE_TTL = 60_000; // 1 min

async function carregarClientesBulk(base44: any) {
  if (_clientesCache && Date.now() - _clientesCache.at < CLIENTES_CACHE_TTL) return _clientesCache;

  const porCodigo = new Map<string, any>();
  const porCnpj = new Map<string, any>();

  let skip = 0;
  const limit = 500;
  let hasMore = true;

  while (hasMore) {
    const batch = await base44.asServiceRole.entities.Cliente.list('-created_date', limit, skip);
    if (!batch || batch.length === 0) break;
    for (const c of batch) {
      // Indexar por todos os códigos possíveis
      for (const campo of [c.codigo_omie, c.codigo_cliente_omie]) {
        const key = String(campo || '').trim();
        if (key) porCodigo.set(key, c);
      }
      const cnpj = String(c.cnpj_cpf || '').replace(/\D/g, '');
      if (cnpj) porCnpj.set(cnpj, c);
    }
    skip += limit;
    hasMore = batch.length === limit;
  }

  _clientesCache = { map: porCodigo, cnpjMap: porCnpj, at: Date.now() };
  console.log(`[listarContasReceber] Cache de clientes: ${porCodigo.size} por código, ${porCnpj.size} por CNPJ`);
  return _clientesCache;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const creds = await resolverCredsOmie(base44);
    if (!creds.app_key || !creds.app_secret) {
      return Response.json({ error: 'Credenciais Omie não configuradas.' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      data_de, data_ate,
      filtrar_por_data = 'V',
      cnpj_cpf,
      pagina = 1,
      registros_por_pagina = 100,
      apenas_pendentes = true,
      bypassCache = false,
      cacheMinutes
    } = body;

    // bypassCache (ou cacheMinutes: 0) força dados frescos — útil logo após emitir boletos,
    // quando o cache de clientes/Omie ainda reflete boleto.cGerado = "N".
    const _cacheMin = typeof cacheMinutes === 'number' ? cacheMinutes : (bypassCache ? 0 : null);
    if (_cacheMin === 0) {
      _clientesCache = null;
      _credsCache = null;
    }

    const param: any = {
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
    const data = await omieCall(base44, 'ListarContasReceber', param, { creds });
    const duracao = Date.now() - t0;

    const STATUS_EXCLUIR = new Set(['LIQUIDADO', 'PAGO', 'CANCELADO', 'RECEBIDO']);
    const titulosRaw = (data.conta_receber_cadastro || []).filter((t: any) => {
      if (apenas_pendentes && t.status_titulo && STATUS_EXCLUIR.has(t.status_titulo.toUpperCase())) return false;
      return true;
    });

    // Mapeamento inicial
    let titulos = titulosRaw.map((t: any) => ({
      codigo_lancamento: t.codigo_lancamento_omie,
      codigo_lancamento_integracao: t.codigo_lancamento_integracao,
      codigo_cliente: t.codigo_cliente_fornecedor,
      numero_documento: t.numero_documento,
      numero_parcela: t.numero_parcela,
      data_emissao: t.data_emissao,
      data_vencimento: t.data_vencimento,
      valor_documento: t.valor_documento,
      valor_pago: t.valor_pago || 0,
      status_titulo: t.status_titulo || 'ABERTO',
      cnpj_cpf: t.cpf_cnpj_cliente,
      nome_cliente: t.nome_cliente || '',
      nome_fantasia: t.nome_fantasia || '',
      id_conta_corrente: t.id_conta_corrente,
      boleto_gerado: t.boleto?.cGerado === 'S',
      numero_boleto: t.boleto?.cNumBoleto || t.numero_boleto || '',
      observacao: t.observacao,
      codigo_barras: t.boleto?.cCodBarras || t.codigo_barras || '',
      linha_digitavel: t.boleto?.dLinhaDig || '',
      url_boleto: t.boleto?.cLinkBoleto || '',
      numero_pedido_vinculado:
        t.numero_pedido || t.cNumPedido || t.pedido?.numero_pedido || t.pedido_venda?.numero_pedido || ''
    }));

    // ✅ ENRIQUECIMENTO BULK — carrega todos os clientes em 1 chamada, faz lookup local
    try {
      const { map: clientesPorCodigo, cnpjMap: clientesPorCnpj } = await carregarClientesBulk(base44);

      let enriquecidos = 0;
      titulos = titulos.map((t: any) => {
        if (t.nome_cliente && t.nome_cliente.trim()) return t; // Omie já retornou nome

        const enr = { ...t };
        // Lookup por codigo_cliente (campo mais confiável)
        const c = clientesPorCodigo.get(String(enr.codigo_cliente || '').trim()) ||
                  clientesPorCnpj.get(String(enr.cnpj_cpf || '').replace(/\D/g, ''));
        if (c) {
          enr.nome_cliente = c.razao_social || c.nome_fantasia || '';
          enr.nome_fantasia = c.nome_fantasia || '';
          if (!enr.cnpj_cpf) enr.cnpj_cpf = c.cnpj_cpf;
          enriquecidos++;
        }
        return enr;
      });
      console.log(`[listarContasReceber] ${enriquecidos}/${titulos.length} títulos enriquecidos com nome do cliente`);
    } catch (e: any) {
      console.warn('[listarContasReceber] enriquecimento falhou:', e.message);
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
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});