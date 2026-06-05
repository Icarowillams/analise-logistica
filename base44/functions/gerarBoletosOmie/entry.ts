import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Endpoint correto para boletos: contareceberboleto (NÃO contareceber)
const OMIE_URL_BOLETO = 'https://app.omie.com.br/api/v1/financas/contareceberboleto/';
const OMIE_URL_CR = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const STATUS_ABERTOS = new Set(['ABERTO', 'A VENCER', 'A PAGAR', 'A RECEBER', 'VENCIDO', 'PARCIAL', 'ATRASADO']);

// 🐛 FIX: Removido cache global _creds — credenciais são resolvidas dinamicamente por request
// Evita warm-start com creds expiradas/suspensas em Deno Deploy
async function resolverCreds(base44) {
  try {
    const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1);
    const cfg = configs?.[0];
    if (cfg?.app_key && cfg?.app_secret) return { app_key: String(cfg.app_key), app_secret: String(cfg.app_secret) };
  } catch { /* fallback */ }
  return { app_key: Deno.env.get('OMIE_APP_KEY'), app_secret: Deno.env.get('OMIE_APP_SECRET') };
}

async function omieCall(url, base44, call, param, tentativa = 1) {
  const { app_key, app_secret } = await resolverCreds(base44);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key, app_secret, param: [param] })
  });
  const data = await res.json();

  // Detectar erros — Omie pode retornar faultstring OU { status: "error", message: "..." }
  const faultMsg = data.faultstring || (data.status === 'error' ? data.message : null);
  if (faultMsg) {
    const msg = String(faultMsg).toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 5) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(url, base44, call, param, tentativa + 1);
    }
    throw new Error(faultMsg);
  }
  return data;
}

// 🐛 FIX: A API ListarContasReceber NÃO retorna nCodPedido no payload.
// Agora usamos ConsultarPedidoOmie para obter CNPJ + NF do pedido,
// depois ListarContasReceber com filtro por CNPJ e casamos por numero_documento (NF).
async function listarTitulosDoPedido(base44, codigoPedido) {
  const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - 365 * 86400000);
  const futuro = new Date(hoje.getTime() + 90 * 86400000);

  // 1) Buscar o pedido no Base44 para obter o CNPJ do cliente e número da NF
  let cnpj = null;
  let numNf = null;
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1);
    const pedido = pedidos?.[0];
    if (pedido) {
      cnpj = String(pedido.cliente_cpf_cnpj || '').replace(/\D/g, '');
      numNf = pedido.numero_nota_fiscal ? String(pedido.numero_nota_fiscal).replace(/\D/g, '') : null;
    }
  } catch { /* fallback sem cnpj */ }

  if (!cnpj) {
    console.warn('[listarTitulosDoPedido] Pedido', codigoPedido, 'sem CNPJ — não é possível buscar títulos');
    return [];
  }

  // 2) Listar contas a receber filtradas por CNPJ + vencimento
  let acumulados = [];
  for (let pag = 1; pag <= 5; pag++) {
    const data = await omieCall(OMIE_URL_CR, base44, 'ListarContasReceber', {
      pagina: pag,
      registros_por_pagina: 100,
      apenas_importado_api: 'N',
      filtrar_por_data_de: fmt(inicio),
      filtrar_por_data_ate: fmt(futuro),
      filtrar_por_cpf_cnpj: cnpj,
      filtrar_apenas_titulos_em_aberto: 'S'
    });
    const lista = data?.conta_receber_cadastro || [];
    acumulados.push(...lista);
    if (pag >= (data?.total_de_paginas || 1)) break;
    await new Promise(r => setTimeout(r, 300));
  }

  // 3) Se tem NF, filtrar por numero_documento (match com número da NF)
  if (numNf) {
    const comNf = acumulados.filter(t => {
      const doc = String(t.numero_documento || '').replace(/\D/g, '');
      return doc === numNf;
    });
    if (comNf.length > 0) return comNf;
  }

  // 4) Fallback: retornar todos os títulos em aberto do cliente (melhor que nada)
  return acumulados;
}

async function gerarBoletosTitulos(base44, titulos, idContaCorrente) {
  const resultados = [];
  for (const titulo of titulos) {
    const codigo = titulo.codigo_lancamento_omie || titulo.codigo_lancamento || titulo;
    const status = String(titulo.status_titulo || '').toUpperCase();
    const aberto = !status || STATUS_ABERTOS.has(status);
    const jaTemBoleto = !!(titulo.numero_boleto && String(titulo.numero_boleto).trim()) || titulo.boleto?.cGerado === 'S';

    if (!aberto) {
      resultados.push({ codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Título ${status}` });
      continue;
    }
    if (jaTemBoleto) {
      resultados.push({ codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Boleto já gerado: ${titulo.numero_boleto || ''}` });
      continue;
    }

    try {
      // Endpoint correto: contareceberboleto, método GerarBoleto, parâmetro nCodTitulo
      const param = { nCodTitulo: Number(codigo) };
      console.log('[GerarBoleto] Enviando para', codigo, ':', JSON.stringify(param));
      const data = await omieCall(OMIE_URL_BOLETO, base44, 'GerarBoleto', param);
      console.log('[GerarBoleto] Resposta Omie para', codigo, ':', JSON.stringify(data));

      // Verificar status de erro retornado pela Omie
      const codStatus = String(data.cCodStatus || '0');
      if (codStatus !== '0' && codStatus !== '') {
        resultados.push({
          codigo_lancamento: codigo,
          sucesso: false,
          mensagem: data.cDesStatus || `Erro Omie (status ${codStatus})`,
          resposta_omie: data
        });
        continue;
      }

      const numBoleto = data.cNumBoleto || '';
      const codBarras = data.cCodBarras || '';
      const linkBoleto = data.cLinkBoleto || '';
      const numBancario = data.cNumBancario || '';
      const sucessoReal = !!(String(numBoleto).trim() || String(codBarras).trim() || String(linkBoleto).trim());

      resultados.push({
        codigo_lancamento: codigo,
        sucesso: sucessoReal,
        numero_boleto: numBoleto,
        codigo_barras: codBarras,
        linha_digitavel: '', // GerarBoleto não retorna linha digitável
        link_boleto: linkBoleto,
        numero_bancario: numBancario,
        data_emissao_boleto: data.dDtEmBol || '',
        mensagem: sucessoReal ? 'Boleto gerado com sucesso' : 'Omie respondeu sem dados de boleto — verifique a conta corrente/convênio bancário no Omie'
      });
    } catch (err) {
      const msg = err.message || '';
      resultados.push({
        codigo_lancamento: codigo,
        sucesso: false,
        skip: msg.toLowerCase().includes('liquidado') || msg.toLowerCase().includes('baixado') || msg.toLowerCase().includes('cancelado'),
        mensagem: msg
      });
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return resultados;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { origem = 'manual', pedidos = [], titulos = [], id_conta_corrente } = body;

    let user = null;
    try { user = await base44.auth.me(); } catch { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let titulosParaGerar = [];
    if (origem === 'auto') {
      const codigosPedido = pedidos.map(p => p.codigo_pedido || p).filter(Boolean);
      for (const codigoPedido of codigosPedido) {
        const titulosPedido = await listarTitulosDoPedido(base44, codigoPedido);
        titulosParaGerar.push(...titulosPedido.map(t => ({ ...t, codigo_pedido: codigoPedido })));
      }
    } else {
      if (!Array.isArray(titulos) || titulos.length === 0) return Response.json({ error: 'titulos vazio' }, { status: 400 });
      titulosParaGerar = titulos;
    }

    const resultados = await gerarBoletosTitulos(base44, titulosParaGerar, id_conta_corrente);
    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso && !r.skip).length;
    const skips = resultados.filter(r => r.skip).length;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'financas/contareceberboleto',
      call: 'GerarBoleto',
      operacao: origem === 'auto' ? 'gerar_boletos_auto' : 'gerar_boletos_lote',
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} boletos falharam` : null,
      tentativas: titulosParaGerar.length,
      usuario_email: user.email,
      payload_resposta: JSON.stringify(resultados).slice(0, 2000)
    }).catch(() => {});

    return Response.json({ sucesso: true, origem, total: titulosParaGerar.length, processados: titulosParaGerar.length, sucessos, erros, skips, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});